// @vitest-environment happy-dom
// The small pieces of the plugin API (mod/src/plugin-api/) on a fake Discord: the log, the JSX factory, a plugin's
// definition and settings store, and the chat box's text (chatInput.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

import { chatBox, ComponentDispatch, reset, state } from "./fake-discord.mjs";
import { main } from "./fake-native.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

// One value saved off its default, as the main process hands the settings to the page when it loads.
main.settings = { Test: { b: true } };
const React = await import("react");
const { log } = await import("../mod/src/plugin-api/log.ts");
const { AgentChatBridgeCreateElement, AgentChatBridgeFragment } = await import("../mod/src/plugin-api/jsx.ts");
const { default: definePlugin } = await import("../mod/src/plugin-api/plugin.ts");
const { definePluginSettings } = await import("../mod/src/plugin-api/settings.ts");
const { chatEditor, getDraft, insertTextIntoChatInputBox, pressEnter, replaceChatInput } = await import("../mod/src/plugin-api/chatInput.ts");

beforeEach(() => {
    reset();
    vi.useRealTimers();
});

test("log: one prefix for the mod, and a failure's cause as an object the console can expand", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => { });
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    const cause = new Error("x");
    log.info("hola");
    log.error("falló", cause);
    log.error("solo");
    assert.deepEqual(info.mock.calls, [["[agent-chat-bridge] hola"]]);
    assert.deepEqual(error.mock.calls, [["[agent-chat-bridge] falló", cause], ["[agent-chat-bridge] solo"]]);
});

test("jsx: elements and fragments are Discord's React's", () => {
    const element = /** @type {any} */ (AgentChatBridgeCreateElement)("b", { id: "x" }, "hola");
    assert.equal(element.type, "b");
    assert.deepEqual(element.props, { id: "x", children: "hola" });
    assert.equal(AgentChatBridgeFragment, React.Fragment);
});

test("plugin: a definition is the plugin as written", () => {
    const plugin = { name: "P", description: "" };
    assert.equal(definePlugin(plugin), plugin);
});

// The store doesn't read the type, and OptionType is a const enum plain JS can't import: 0 for every setting.
const settingsOf = name => {
    const settings = definePluginSettings({
        a: { type: 0, description: "a", default: "x" },
        b: { type: 0, description: "b", default: false },
        c: { type: 0, description: "c", default: true }
    });
    settings.pluginName = name;
    return settings;
};

test("settings: the store reads the saved value or the default, and spreads with every setting", () => {
    const { store, def } = settingsOf("Test");
    assert.equal(def.a.default, "x");
    const { a, ...rest } = store;
    assert.equal(a, "x");
    assert.deepEqual(rest, { b: true, c: true });
    assert.deepEqual(Object.keys(store), ["a", "b", "c"]);
    assert.equal("a" in store, true);
    assert.equal("d" in store, false);
    assert.equal(/** @type {any} */ (store).d, undefined);
    assert.equal(Object.getOwnPropertyDescriptor(store, "d"), undefined);
    assert.deepEqual(Object.getOwnPropertyDescriptor(store, "b"), { value: true, enumerable: true, configurable: true, writable: false });
});

test("settings: a plugin with nothing saved reads its defaults", () => {
    assert.deepEqual({ ...settingsOf("Otro").store }, { a: "x", b: false, c: true });
});

test("chat box: the draft is the chat's own, not another kind of draft", () => {
    state.drafts.set("5", "hola");
    assert.equal(getDraft("5"), "hola");
    assert.equal(getDraft("6"), "");
});

test("chat box: its editor is the chat's, not the edit box of a sent message", () => {
    const edit = document.body.appendChild(document.createElement("div"));
    edit.setAttribute("data-slate-editor", "true");
    assert.equal(chatEditor(), null);
    const box = chatBox("hola");
    assert.ok(chatEditor() === box, "the chat's box");
    edit.remove();
});

test("chat box: Enter goes to the editor as the keyboard sends it", () => {
    const box = chatBox();
    const seen = [];
    box.addEventListener("keydown", e => seen.push([e.key, e.code, e.keyCode, e.bubbles, e.cancelable]));
    document.body.addEventListener("keydown", () => seen.push("bubbled"), { once: true });
    pressEnter(box);
    assert.deepEqual(seen, [["Enter", "Enter", 13, true, true], "bubbled"]);
});

test("chat box: text goes in at the cursor through Discord's own event", () => {
    insertTextIntoChatInputBox("hola");
    assert.deepEqual(ComponentDispatch.dispatchToLastSubscribed.mock.calls, [["INSERT_TEXT", { rawText: "hola", plainText: "hola" }]]);
});

test("chat box: replacing selects the whole box, waits for the editor to read the selection, then writes over it", async () => {
    vi.useFakeTimers();
    const box = chatBox("antes");
    const done = replaceChatInput("después");
    assert.ok(document.activeElement === box, "focused");
    assert.equal(document.getSelection()?.toString(), "antes");
    await vi.advanceTimersByTimeAsync(149);
    assert.equal(ComponentDispatch.dispatchToLastSubscribed.mock.calls.length, 0);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    assert.equal(getDraft("1"), "después");
    assert.equal(box.textContent, "después");
});

test("chat box: with no box on screen, replacing just writes", async () => {
    await replaceChatInput("hola");
    assert.deepEqual(ComponentDispatch.dispatchToLastSubscribed.mock.calls, [["INSERT_TEXT", { rawText: "hola", plainText: "hola" }]]);
});
