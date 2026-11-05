// @vitest-environment happy-dom
// The renderer's entry point (mod/src/renderer/index.ts) on a fake Discord: what it gives Discord's patched code, the
// CLI's handler, the styles and the plugins it registers and starts. Run with `pnpm test`.
import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { main, native } from "./fake-native.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

// Before Discord's page has a head, as when the renderer runs before Discord's scripts.
const head = document.head;
head.remove();
const listeners = vi.spyOn(document, "addEventListener");
const { registerPlugin } = await import("../mod/src/renderer/index.ts");
const { chatBarButtons, plugins, popoverButtons } = await import("../mod/src/renderer/registry.ts");
const { _injectButtons } = await import("../mod/src/plugin-api/chatButtons.tsx");
const { _buildPopoverElements } = await import("../mod/src/plugin-api/messagePopover.tsx");
const { compose } = await import("../mod/src/renderer/compose.ts");
// Read now: the mocks' calls are cleared before each test (restoreMocks).
const atLoad = {
    watch: native.onWatchChange.mock.calls.length,
    dictation: native.dictation.onEvent.mock.calls.length,
    keydown: listeners.mock.calls.filter(([type]) => type === "keydown").length
};

test("entry: Discord's patched code reaches the mod through a frozen object under the mod's symbol", () => {
    const api = /** @type {any} */ (window)[Symbol.for("agent-chat-bridge")];
    assert.deepEqual(Object.keys(api), ["_injectButtons", "_buildPopoverElements"]);
    assert.equal(api._injectButtons, _injectButtons);
    assert.equal(api._buildPopoverElements, _buildPopoverElements);
    assert.equal(Object.isFrozen(api), true);
    assert.equal(Object.keys(window).includes("agent-chat-bridge"), false);
});

test("entry: the CLI's requests go to compose, and the watched chats are listened for", () => {
    assert.equal(main.compose, compose);
    assert.equal(atLoad.watch, 1);
});

test("entry: the plugins register in order, with their settings, buttons and styles, and start", () => {
    assert.deepEqual(plugins.map(p => p.name), ["Corrector", "Autorespuesta", "Dictation"]);
    assert.deepEqual(plugins.map(p => p.settings?.pluginName), ["Corrector", "Autorespuesta", "Dictation"]);
    assert.deepEqual([...chatBarButtons.keys()], ["Corrector", "Autorespuesta", "Dictation"]);
    assert.deepEqual([...popoverButtons.keys()], ["Corrector", "Autorespuesta"]);
    assert.equal(atLoad.dictation, 1, "Dictation started");
    assert.equal(atLoad.keydown, 2, "Corrector and Dictation listen to the keyboard");
});

test("entry: the styles wait for the page's head, then go in: the mod's and each plugin's", () => {
    assert.equal(document.querySelectorAll("style").length, 0);
    document.documentElement.prepend(head);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    document.dispatchEvent(new Event("DOMContentLoaded"));
    const styles = [...document.head.querySelectorAll("style")].map(s => s.textContent ?? "");
    assert.equal(styles.length, 3, "the mod's, Autorespuesta's and Dictation's, once each");
    const [mod = "", autoreply = "", dictation = ""] = styles;
    assert.match(mod, /\.dm-settings \.dm-tabs/);
    assert.match(autoreply, /dm-autoreply-selecting/);
    assert.match(dictation, /dm-dictation/);
});

test("entry: a plugin declares only what it has; one with a style, once the page has its head, gets it at once", () => {
    const before = plugins.length;
    registerPlugin({ name: "Mínimo", description: "" });
    assert.equal(plugins.length, before + 1);
    assert.equal(chatBarButtons.has("Mínimo") || popoverButtons.has("Mínimo"), false);
    const start = vi.fn();
    registerPlugin({ name: "Estilo", description: "", style: ".x{}", start });
    assert.equal(document.head.lastElementChild?.textContent, ".x{}");
    assert.equal(start.mock.calls.length, 1);
});
