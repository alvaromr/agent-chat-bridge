// @vitest-environment happy-dom
// The Autorespuesta plugin (plugins/autorespuesta/index.tsx) and the plugins' shared renderer side (plugins/shared/)
// on a fake Discord, with Claude's answers made up: picking the message to answer from, what goes to Claude, and when
// the reply lands in the box. Run with `pnpm test`.
import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

import { $, $$, keydown, mouse, render } from "./dom.mjs";
import { chatBox, loaded, reset, showToast, state } from "./fake-discord.mjs";
import { native } from "./fake-native.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

const React = await import("react");
const { savedSettings } = await import("../mod/src/renderer/settings.ts");
const { default: autorespuesta } = await import("../plugins/autorespuesta/index.tsx");
const { SparklesIcon, SpellcheckIcon } = await import("../plugins/shared/index.tsx");

const toasts = () => showToast.mock.calls.map(([toast]) => toast);
const asked = () => native.runClaude.mock.calls.map(([prompt, input, model]) => ({ prompt, input, model }));
const idle = () => vi.advanceTimersByTimeAsync(10_000);
const selecting = () => document.body.classList.contains("dm-autoreply-selecting");

const ana = { id: "111", username: "ana", globalName: "Ana" };
const message = (id, author, content, fields = {}) => ({ id, channel_id: "1", content, author, attachments: [], ...fields });

beforeEach(() => {
    reset();
    vi.useFakeTimers();
    autorespuesta.settings.pluginName = autorespuesta.name;
    for (const key of Object.keys(savedSettings)) delete savedSettings[key];
    native.runClaude.mockImplementation(async () => ({ ok: true, text: "¡Genial!" }));
    loaded("1", [message("1", state.me, "Yo antes"), message("2", ana, "¿Vienes?"), message("3", state.me, "")]);
});

/** The chat box button, rendered in the main chat. */
function button() {
    render(/** @type {any} */ (autorespuesta.chatBarButton?.render(/** @type {any} */ ({ isMainChat: true, channel: { id: "1" } }))));
    return $("[role=button]");
}
/** A message of the chat on screen, as Discord renders it. */
function onScreen(id, channelId = "1") {
    const element = document.body.appendChild(Object.assign(document.createElement("div"), { id: `chat-messages-${channelId}-${id}` }));
    return element.appendChild(document.createElement("span"));
}

test("autorespuesta: no button outside the main chat box", () => {
    assert.equal(autorespuesta.chatBarButton?.render(/** @type {any} */ ({ isMainChat: false, channel: { id: "1" } })), null);
});

test("autorespuesta: the button starts picking a message; a second press or Escape stops it", () => {
    const b = button();
    assert.equal(b.getAttribute("aria-label"), "Generar respuesta");
    mouse(b);
    assert.equal(selecting(), true);
    assert.deepEqual(toasts(), [{ text: "Haz clic en el mensaje desde el que empezar (Esc para cancelar)" }]);
    mouse(b);
    assert.equal(selecting(), false);
    mouse(b);
    keydown(document.body, "a");
    assert.equal(selecting(), true, "another key doesn't stop it");
    keydown(document.body, "Escape");
    assert.equal(selecting(), false);
    mouse(onScreen("2"));
    assert.equal(native.runClaude.mock.calls.length, 0, "once stopped, a click is just a click");
});

test("autorespuesta: a click on a message of the chat answers from it, and the click goes no further", async () => {
    chatBox("");
    mouse(button());
    const outside = document.body.appendChild(document.createElement("p"));
    mouse(outside);
    mouse(onScreen("2", "9"));
    assert.equal(selecting(), true, "a click elsewhere, or in another chat's list, keeps waiting");
    const clicked = vi.fn();
    document.body.addEventListener("click", clicked);
    const event = mouse(onScreen("2"));
    assert.equal(event.defaultPrevented, true);
    assert.equal(clicked.mock.calls.length, 0);
    assert.equal(selecting(), false);
    await idle();
    assert.equal($('[data-slate-editor="true"]').textContent, "¡Genial!");
});

test("autorespuesta: Claude gets the conversation from that message, the user's earlier ones as examples, and the draft as a guide", async () => {
    chatBox("dile que sí");
    autorespuesta.messagePopoverButton?.render(/** @type {any} */ (message("2", ana, "")))?.onClick?.();
    await idle();
    const [{ prompt, input, model }] = asked();
    assert.match(prompt, /^Escribe mi siguiente mensaje/);
    assert.doesNotMatch(prompt, /Notas sobre mi forma de escribir/);
    assert.equal(model, "claude-sonnet-5-5");
    assert.equal(input, [
        "<ejemplos>", '"Yo antes"', "</ejemplos>", "",
        "<conversación>", '{"autor":"Ana","yo":false,"texto":"¿Vienes?"}', '{"autor":"Yo","yo":true,"texto":""}', "</conversación>", "",
        "<guía>", '"dile que sí"', "</guía>"
    ].join("\n"));
    assert.equal($('[data-slate-editor="true"]').textContent, "¡Genial!", "the draft is replaced by the reply");
});

test("autorespuesta: the examples are the user's messages with text from before the chosen one; it may be the first loaded", async () => {
    chatBox("");
    loaded("1", [message("0", ana, "hola"), message("1", state.me, "Yo antes"), message("2", state.me, ""), message("3", ana, "¿Vienes?"),
        message("4", state.me, "luego")]);
    autorespuesta.messagePopoverButton?.render(/** @type {any} */ (message("3", ana, "")))?.onClick?.();
    await idle();
    assert.match(asked()[0].input, /^<ejemplos>\n"Yo antes"\n<\/ejemplos>\n/);
    autorespuesta.messagePopoverButton?.render(/** @type {any} */ (message("0", ana, "")))?.onClick?.();
    await idle();
    assert.equal(asked().length, 2, "from the first loaded message too");
    assert.doesNotMatch(asked()[1].input, /<ejemplos>/);
});

test("autorespuesta: picking hears clicks and Escape before Discord's own elements, which stop them", async () => {
    const stop = e => e.stopPropagation();
    const target = onScreen("2");
    target.addEventListener("keydown", stop);
    mouse(button());
    keydown(target, "Escape");
    assert.equal(selecting(), false);
    target.addEventListener("click", stop);
    mouse($("[role=button]"));
    mouse(target);
    await idle();
    assert.equal(native.runClaude.mock.calls.length, 1);
});

test("autorespuesta: once picking ends, neither a click nor Escape is the plugin's any longer", async () => {
    const listeners = vi.spyOn(document, "removeEventListener");
    mouse(button());
    keydown(document.body, "Escape");
    assert.deepEqual(listeners.mock.calls.map(([type, , capture]) => [type, capture]), [["click", true], ["keydown", true]]);
});

test("autorespuesta: style notes join the prompt; the examples follow the setting, none with 0", async () => {
    savedSettings.Autorespuesta = { prompt: "P", styleNotes: "Escribo corto.", examples: 0, model: "claude-haiku-5-5" };
    chatBox("");
    autorespuesta.messagePopoverButton?.render(/** @type {any} */ (message("2", ana, "")))?.onClick?.();
    await idle();
    assert.deepEqual(asked()[0], { prompt: "P\n\nNotas sobre mi forma de escribir:\nEscribo corto.", input: asked()[0].input, model: "claude-haiku-5-5" });
    assert.doesNotMatch(asked()[0].input, /<ejemplos>/);
    savedSettings.Autorespuesta = { styleNotes: "  ", examples: 1 };
    loaded("1", [message("0", state.me, "uno"), message("1", state.me, "dos"), message("2", ana, "x")]);
    autorespuesta.messagePopoverButton?.render(/** @type {any} */ (message("2", ana, "")))?.onClick?.();
    await idle();
    assert.match(asked()[1].prompt, /^Escribe mi siguiente mensaje[^]*cómo escribo/);
    assert.doesNotMatch(asked()[1].prompt, /Notas sobre/);
    assert.match(asked()[1].input, /^<ejemplos>\n"dos"\n<\/ejemplos>/);
});

test("autorespuesta: the button on a message answers from it; one not loaded says so", async () => {
    const item = autorespuesta.messagePopoverButton?.render(/** @type {any} */ (message("9", ana, "")));
    assert.equal(item?.label, "Generar respuesta desde aquí");
    assert.equal(typeof item?.icon, "function");
    item?.onClick?.();
    await idle();
    assert.deepEqual(toasts(), [{ text: "Ese mensaje no está cargado", variant: "critical" }]);
    assert.equal(native.runClaude.mock.calls.length, 0);
});

test("autorespuesta: no reply, or a draft changed meanwhile, leaves the box as it is", async () => {
    const box = chatBox("antes");
    native.runClaude.mockResolvedValueOnce({ ok: false, text: "límite" });
    autorespuesta.messagePopoverButton?.render(/** @type {any} */ (message("2", ana, "")))?.onClick?.();
    await idle();
    assert.equal(box.textContent, "antes");
    native.runClaude.mockImplementationOnce(async () => {
        state.drafts.set("1", "otra cosa");
        return { ok: true, text: "¡Genial!" };
    });
    autorespuesta.messagePopoverButton?.render(/** @type {any} */ (message("2", ana, "")))?.onClick?.();
    await idle();
    assert.deepEqual(toasts().at(-1), { text: "El texto cambió mientras se generaba; no lo toco", variant: "critical" });
    assert.equal(box.textContent, "antes");
});

test("autorespuesta: a failure, from the toolbar or from a picked message, is shown to the user", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    native.runClaude.mockRejectedValue("se cerró");
    autorespuesta.messagePopoverButton?.render(/** @type {any} */ (message("2", ana, "")))?.onClick?.();
    await idle();
    assert.deepEqual(toasts().at(-1), { text: "No se pudo terminar: se cerró", variant: "critical" });
    mouse(button());
    mouse(onScreen("2"));
    await idle();
    assert.deepEqual(toasts().at(-1), { text: "No se pudo terminar: se cerró", variant: "critical" });
    assert.deepEqual(error.mock.calls[0], ["[agent-chat-bridge] A plugin action failed: string: se cerró"]);
});

test("autorespuesta: its style marks the message under the pointer while picking", () => {
    assert.match(autorespuesta.style ?? "", /\.dm-autoreply-selecting/);
});

test("shared: the icons take the size and class given, 20 px by default", () => {
    for (const Icon of [SparklesIcon, SpellcheckIcon]) {
        const { container } = render(React.createElement(React.Fragment, null, React.createElement(Icon), React.createElement(Icon, { height: 16, width: 18, className: "x" })));
        const [plain, sized] = $$("svg", container);
        assert.deepEqual([plain.getAttribute("height"), plain.getAttribute("width"), plain.getAttribute("class")], ["20", "20", null]);
        assert.deepEqual([sized.getAttribute("height"), sized.getAttribute("width"), sized.getAttribute("class")], ["16", "18", "x"]);
    }
});
