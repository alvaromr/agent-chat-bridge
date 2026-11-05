// @vitest-environment happy-dom
// The Corrector plugin (plugins/corrector/index.tsx) on a fake Discord, with Claude's answers made up: its chat box
// button, its button on the user's messages, Ctrl+Enter, and Enter on an empty box, with every way a correction can be
// dropped. Run with `pnpm test`.
import assert from "node:assert/strict";

import { beforeAll, beforeEach, test, vi } from "vitest";

import { $, keydown, mouse, render } from "./dom.mjs";
import { chatBox, ComponentDispatch, loaded, MessageActions, reset, showToast, state } from "./fake-discord.mjs";
import { native } from "./fake-native.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

const { savedSettings } = await import("../mod/src/renderer/settings.ts");
const { default: corrector } = await import("../plugins/corrector/index.tsx");

/** Claude's answers, in order; each call to runClaude takes the next. */
let answers = [];
const asked = () => native.runClaude.mock.calls.map(([prompt, input, model]) => ({ prompt, input, model }));
const toasts = () => showToast.mock.calls.map(([toast]) => toast);

/** Lets fake time pass until nothing the plugin started is still waiting. */
const idle = () => vi.advanceTimersByTimeAsync(10_000);

beforeAll(() => {
    corrector.settings.pluginName = corrector.name;
    corrector.start?.();
});
beforeEach(() => {
    reset();
    vi.useFakeTimers();
    for (const key of Object.keys(savedSettings)) delete savedSettings[key];
    answers = [];
    native.runClaude.mockImplementation(async () => answers.shift() ?? { ok: true, text: "" });
    state.selected = "1";
});

const sent = (fields = {}) => ({ id: "10", channel_id: "1", content: "Hola, ¿que tal?", author: state.me, ...fields });

test("corrector: the button of the main chat box corrects its draft in place", async () => {
    answers = [{ ok: true, text: "<mensaje>\nHola, ¿qué tal?\n</mensaje>" }];
    const box = chatBox("Hola, ¿que tal?");
    const button = corrector.chatBarButton?.render(/** @type {any} */ ({ isMainChat: true, channel: { id: "1" } }));
    render(button);
    assert.equal($("[role=button]").getAttribute("aria-label"), "Corregir ortografía");
    mouse($("[role=button]"));
    await idle();
    assert.equal(box.textContent, "Hola, ¿qué tal?");
    const [{ prompt, input, model }] = asked();
    assert.match(prompt, /^Eres un corrector ortográfico mínimo\./);
    assert.equal(input, "<mensaje>\nHola, ¿que tal?\n</mensaje>");
    assert.equal(model, "claude-sonnet-5-5");
    assert.deepEqual(toasts(), [{ text: "Consultando a Claude…" }]);
});

test("corrector: no button outside the main chat box", () => {
    assert.equal(corrector.chatBarButton?.render(/** @type {any} */ ({ isMainChat: false, channel: { id: "1" } })), null);
});

/** Corrects the draft with the chat box button. */
async function correctDraft() {
    render(/** @type {any} */ (corrector.chatBarButton?.render(/** @type {any} */ ({ isMainChat: true, channel: { id: "1" } }))));
    mouse($("[role=button]"));
    await idle();
}

test("corrector: an empty draft asks nothing", async () => {
    chatBox("  ");
    await correctDraft();
    assert.equal(native.runClaude.mock.calls.length, 0);
});

test("corrector: the prompt and model come from the settings, and the case of the original is kept", async () => {
    savedSettings.Corrector = { prompt: "Corrige.", model: "claude-haiku-5-5" };
    answers = [{ ok: true, text: "HOLA, QUÉ TAL" }];
    const box = chatBox("hola, que tal");
    await correctDraft();
    assert.deepEqual(asked()[0].prompt, "Corrige.");
    assert.deepEqual(asked()[0].model, "claude-haiku-5-5");
    assert.equal(box.textContent, "hola, qué tal");
});

test("corrector: nothing to fix, an answer that fails, or a draft changed meanwhile leave the box as it is", async () => {
    const box = chatBox("Hola");
    answers = [{ ok: true, text: "Hola" }];
    await correctDraft();
    assert.deepEqual(toasts().at(-1), { text: "Sin faltas que corregir", variant: "success" });
    answers = [{ ok: false, text: "sin red" }];
    await correctDraft();
    assert.deepEqual(toasts().at(-1), { text: "Claude: sin red", variant: "critical" });
    box.textContent = "Ola";
    state.drafts.set("1", "Ola");
    native.runClaude.mockImplementationOnce(async () => {
        state.drafts.set("1", "Ola, otro");
        return { ok: true, text: "Hola" };
    });
    await correctDraft();
    assert.deepEqual(toasts().at(-1), { text: "El texto cambió mientras se corregía; no lo toco", variant: "critical" });
    assert.equal(box.textContent, "Ola");
});

test("corrector: only the tags around the whole answer come off, with the blank lines next to them", async () => {
    const box = chatBox("ola");
    answers = [{ ok: true, text: "<mensaje>\n\nhola\n\n</mensaje>" }];
    await correctDraft();
    assert.equal(box.textContent, "hola");
    const tagged = "di <mensaje> y </mensaje> ya";
    box.textContent = tagged;
    state.drafts.set("1", tagged);
    answers = [{ ok: true, text: tagged }];
    await correctDraft();
    assert.deepEqual(toasts().at(-1), { text: "Sin faltas que corregir", variant: "success" }, "tags inside the message stay");
});

test("corrector: an answer that rewrites the message gets a second try, and is dropped if it rewrites again", async () => {
    const box = chatBox("s epodria");
    answers = [{ ok: true, text: "Es posible" }, { ok: true, text: "se podría" }];
    await correctDraft();
    assert.equal(box.textContent, "se podría");
    assert.equal(native.runClaude.mock.calls.length, 2);
    answers = [{ ok: true, text: "Otra cosa" }, { ok: true, text: "Algo distinto" }];
    await correctDraft();
    assert.deepEqual(toasts().at(-1), { text: "La corrección cambiaba demasiado el mensaje; descartada", variant: "critical" });
    assert.equal(box.textContent, "se podría");
});

test("corrector: an action that fails shows the user why, not only the console", async () => {
    native.runClaude.mockRejectedValueOnce(new Error("sin conexión con el proceso principal"));
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    chatBox("Ola");
    await correctDraft();
    assert.deepEqual(toasts().at(-1), { text: "No se pudo terminar: sin conexión con el proceso principal", variant: "critical" });
    assert.deepEqual(error.mock.calls, [["[agent-chat-bridge] A plugin action failed: Error: sin conexión con el proceso principal"]]);
});

test("corrector: the button on a message is only on the user's own messages with text", () => {
    const render = message => corrector.messagePopoverButton?.render(/** @type {any} */ (message));
    assert.equal(render(sent({ author: { id: "otro" } })), null);
    assert.equal(render(sent({ content: "" })), null);
    const item = render(sent());
    assert.equal(item?.label, "Corregir ortografía");
    assert.equal(typeof item?.icon, "function");
});

/** Clicks the Corrector's button on the user's sent message and lets fake time pass until it is done. */
async function correctSent(message = sent()) {
    loaded("1", [message]);
    corrector.messagePopoverButton?.render(/** @type {any} */ (message))?.onClick?.();
    await idle();
}

test("corrector: a sent message is edited and reported corrected once Discord shows the new text", async () => {
    answers = [{ ok: true, text: "Hola, ¿qué tal?" }];
    await correctSent();
    assert.deepEqual(MessageActions.editMessage.mock.calls, [["1", "10", { content: "Hola, ¿qué tal?" }]]);
    assert.deepEqual(toasts().at(-1), { text: "Mensaje corregido", variant: "success" });
});

test("corrector: an edit Discord never confirms is reported as unconfirmed, not as corrected", async () => {
    answers = [{ ok: true, text: "Hola, ¿qué tal?" }];
    MessageActions.editMessage.mockImplementation(async () => { });
    await correctSent();
    assert.deepEqual(toasts().at(-1), { text: "Discord no confirmó la corrección; revisa el mensaje", variant: "critical" });
});

test("corrector: a sent message with nothing to fix is not edited", async () => {
    answers = [{ ok: true, text: "Hola, ¿que tal?" }];
    await correctSent();
    assert.equal(MessageActions.editMessage.mock.calls.length, 0);
});

test("corrector: a failure on a sent message is shown too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => { });
    native.runClaude.mockRejectedValueOnce(new Error("roto"));
    await correctSent();
    assert.deepEqual(toasts().at(-1), { text: "No se pudo terminar: roto", variant: "critical" });
});

test("corrector: Enter in an empty box corrects the user's last message with text", async () => {
    const box = chatBox("");
    loaded("1", [sent({ id: "8", content: "ola" }), sent({ id: "9", content: "" }), { ...sent({ id: "11", content: "de otro" }), author: { id: "otro" } }]);
    answers = [{ ok: true, text: "hola" }];
    keydown(box, "Enter");
    await idle();
    assert.deepEqual(MessageActions.editMessage.mock.calls, [["1", "8", { content: "hola" }]]);
    loaded("1", [{ ...sent(), author: { id: "otro" } }]);
    keydown(box, "Enter");
    await idle();
    assert.equal(native.runClaude.mock.calls.length, 1, "no message of the user's: nothing to correct");
});

test("corrector: before Discord has the user's session, there is no message of theirs to correct, and no button", async () => {
    const box = chatBox("");
    const own = sent({ content: "ola" });
    loaded("1", [own]);
    /** @type {any} */ (state).me = undefined;
    keydown(box, "Enter");
    await idle();
    assert.equal(native.runClaude.mock.calls.length, 0);
    assert.deepEqual(toasts(), [], "nothing failed");
    assert.equal(corrector.messagePopoverButton?.render(/** @type {any} */ (own)), null);
});

test("corrector: a box with only spaces counts as empty for Enter", async () => {
    const box = chatBox("  ");
    loaded("1", [sent({ content: "ola" })]);
    answers = [{ ok: true, text: "hola" }];
    keydown(box, "Enter");
    await idle();
    assert.equal(MessageActions.editMessage.mock.calls.length, 1);
});

test("corrector: it hears Enter before Discord's editor, and Ctrl+Enter reaches no other listener", async () => {
    const box = chatBox("ola");
    box.addEventListener("keydown", e => e.stopPropagation());
    const later = vi.fn();
    document.addEventListener("keydown", later, true);
    answers = [{ ok: true, text: "hola" }];
    keydown(box, "Enter", { ctrlKey: true });
    await idle();
    assert.equal(native.runClaude.mock.calls.length, 1, "heard though the editor stops the event");
    assert.equal(later.mock.calls.filter(([e]) => e.ctrlKey).length, 0);
    document.removeEventListener("keydown", later, true);
});

test("corrector: Ctrl+Enter sends once Discord shows the corrected text, and not before", async () => {
    const box = chatBox("ola");
    const enters = [];
    box.addEventListener("keydown", e => void (e.key === "Enter" && !e.ctrlKey && enters.push([state.drafts.get("1"), Date.now()])));
    // Discord shows the inserted text a moment later.
    ComponentDispatch.dispatchToLastSubscribed.mockImplementation((event, { rawText }) => {
        if (event === "INSERT_TEXT") setTimeout(() => void state.drafts.set("1", rawText), 100);
    });
    answers = [{ ok: true, text: "hola" }];
    const start = Date.now();
    keydown(box, "Enter", { ctrlKey: true });
    await idle();
    assert.equal(enters.length, 1);
    const [[text, at]] = enters;
    assert.equal(text, "hola");
    assert.ok(at - start < 400, `${at - start} ms`);
});

test("corrector: Enter corrects nothing with text or attachments in the box, with the setting off, or outside the chat box", async () => {
    loaded("1", [sent({ content: "ola" })]);
    const box = chatBox("algo");
    keydown(box, "Enter");
    state.drafts.set("1", "");
    state.uploads.set("1", 1);
    keydown(box, "Enter");
    state.uploads.delete("1");
    savedSettings.Corrector = { enterCorrectsLast: false };
    keydown(box, "Enter");
    delete savedSettings.Corrector;
    const edit = document.body.appendChild(Object.assign(document.createElement("div"), { id: "chat-messages-1-10" }));
    const editBox = edit.appendChild(document.createElement("div"));
    editBox.setAttribute("data-slate-editor", "true");
    keydown(editBox, "Enter");
    keydown(document.body, "Enter");
    for (const init of [{ shiftKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { repeat: true }]) keydown(box, "Enter", init);
    keydown(box, "a");
    await idle();
    assert.equal(native.runClaude.mock.calls.length, 0);
    edit.remove();
});

test("corrector: Ctrl+Enter corrects the draft, then sends it with Discord's own Enter", async () => {
    const box = chatBox("ola");
    const enters = [];
    box.addEventListener("keydown", e => void (e.key === "Enter" && !e.ctrlKey && enters.push(box.textContent)));
    answers = [{ ok: true, text: "hola" }];
    const event = keydown(box, "Enter", { ctrlKey: true });
    assert.equal(event.defaultPrevented, true, "Discord doesn't get the Ctrl+Enter");
    await idle();
    assert.deepEqual(enters, ["hola"]);
});

test("corrector: Ctrl+Enter with a failed correction sends the text as it was; with an empty box, Discord handles it", async () => {
    const box = chatBox("ola");
    const enters = [];
    box.addEventListener("keydown", e => void (e.key === "Enter" && !e.ctrlKey && enters.push(box.textContent)));
    answers = [{ ok: false, text: "x" }];
    keydown(box, "Enter", { ctrlKey: true });
    await idle();
    assert.deepEqual(enters, ["ola"]);
    state.drafts.set("1", " ");
    const event = keydown(box, "Enter", { ctrlKey: true });
    assert.equal(event.defaultPrevented, false);
});

test("corrector: Ctrl+Enter sends nothing when the draft changed while correcting", async () => {
    const box = chatBox("ola");
    const enters = vi.fn();
    box.addEventListener("keydown", e => void (e.key === "Enter" && !e.ctrlKey && enters()));
    native.runClaude.mockImplementationOnce(async () => {
        state.drafts.set("1", "ola y más");
        return { ok: true, text: "hola" };
    });
    keydown(box, "Enter", { ctrlKey: true });
    await idle();
    assert.equal(enters.mock.calls.length, 0);
    assert.deepEqual(toasts().at(-1), { text: "El texto cambió mientras se corregía; no lo envío", variant: "critical" });
});

test("corrector: while one correction runs, another Enter waits its turn; a failure frees it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => { });
    const box = chatBox("ola");
    let finish = () => { };
    native.runClaude.mockImplementationOnce(() => new Promise(resolve => void (finish = () => resolve({ ok: true, text: "hola" }))));
    keydown(box, "Enter", { ctrlKey: true });
    const second = keydown(box, "Enter", { ctrlKey: true });
    assert.equal(second.defaultPrevented, true, "still kept from Discord");
    state.drafts.set("1", "");
    loaded("1", [sent({ content: "ola" })]);
    keydown(box, "Enter");
    assert.equal(native.runClaude.mock.calls.length, 1);
    finish();
    await idle();
    native.runClaude.mockRejectedValueOnce(new Error("roto"));
    keydown(box, "Enter");
    await idle();
    assert.deepEqual(toasts().at(-1), { text: "No se pudo terminar: roto", variant: "critical" });
    answers = [{ ok: true, text: "hola" }];
    keydown(box, "Enter");
    await idle();
    assert.equal(native.runClaude.mock.calls.length, 3, "free again after the failure");
});
