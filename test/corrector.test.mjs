// Regression tests of the Corrector plugin (plugins/corrector/index.tsx) on a fake Discord. Run with `pnpm test`.
import assert from "node:assert/strict";

import { afterEach, beforeEach, test, vi } from "vitest";

import { MessageActions, reset, showToast, state } from "./fake-discord.mjs";

// What the main process answers for claude -p; the renderer reads the settings through `window` when it loads.
const native = vi.hoisted(() => {
    /** @type {{ answer: () => Promise<{ ok: boolean, text: string }> }} */
    const runClaude = { answer: async () => ({ ok: true, text: "" }) };
    /** @type {any} */ (globalThis).window = Object.assign(globalThis, {
        DiscordModNative: { getSettings: () => ({}), runClaude: () => runClaude.answer() }
    });
    return runClaude;
});
vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

const { default: corrector } = await import("../plugins/corrector/index.tsx");

/** The user's sent message, with only the fields the Corrector reads. @type {any} */
const sent = { id: "10", channel_id: "1", content: "Hola, ¿que tal?", author: { id: "me" } };
/** Clicks the Corrector's button on the user's sent message and lets fake time pass until it is done. */
async function correctSent() {
    const item = corrector.messagePopoverButton?.render(sent);
    assert.ok(item?.onClick);
    const done = item.onClick();
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
}
const toasts = () => showToast.mock.calls.map(([toast]) => toast);

beforeEach(() => {
    vi.useFakeTimers();
    reset();
    state.messages.set(sent.id, { ...sent });
    native.answer = async () => ({ ok: true, text: "Hola, ¿qué tal?" });
});
afterEach(() => vi.useRealTimers());

test("corrector: a sent message is reported corrected once Discord shows the new text", async () => {
    MessageActions.editMessage.mockImplementation(async (_, id, { content }) => {
        state.messages.set(id, { ...sent, content });
    });
    await correctSent();
    assert.deepEqual(MessageActions.editMessage.mock.calls, [["1", "10", { content: "Hola, ¿qué tal?" }]]);
    assert.deepEqual(toasts().at(-1), { text: "Mensaje corregido", variant: "success" });
});

test("corrector: an edit Discord never confirms is reported as unconfirmed, not as corrected", async () => {
    MessageActions.editMessage.mockImplementation(async () => { });
    await correctSent();
    assert.deepEqual(toasts().at(-1), { text: "Discord no confirmó la corrección; revisa el mensaje", variant: "critical" });
});

test("corrector: an action that fails shows the user why, not only the console", async () => {
    native.answer = async () => {
        throw new Error("sin conexión con el proceso principal");
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    await correctSent();
    assert.deepEqual(toasts().at(-1), { text: "No se pudo terminar: sin conexión con el proceso principal", variant: "critical" });
    assert.deepEqual(error.mock.calls, [["[discord-mod] A plugin action failed: Error: sin conexión con el proceso principal"]]);
});
