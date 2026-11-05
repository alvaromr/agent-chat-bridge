// @vitest-environment happy-dom
// The plugin buttons in Discord's chat box and in a message's toolbar (mod/src/plugin-api/chatButtons.tsx and
// messagePopover.tsx) on a fake Discord: what the patches put in Discord's code, which buttons render, their names,
// tooltips and clicks, and what a failing plugin leaves. Run with `pnpm test`.
import "./fake-native.mjs";

import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

import { $, $$, mouse, render } from "./dom.mjs";
import { reset, showToast } from "./fake-discord.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));
// Discord's hashed class names, as its CSS modules export them.
vi.mock("../mod/src/renderer/webpack.ts", async original => ({
    .../** @type {any} */ (await original()),
    findCssClasses: (...names) => Object.fromEntries(names.map(name => [name, `${name}_${names[0]}`]))
}));

const React = await import("react");
const { ChatBarButton, _injectButtons } = await import("../mod/src/plugin-api/chatButtons.tsx");
const { _buildPopoverElements } = await import("../mod/src/plugin-api/messagePopover.tsx");
const { definePluginSettings } = await import("../mod/src/plugin-api/settings.ts");
const { canonicalize } = await import("../mod/src/renderer/regex.ts");
const { chatBarButtons, plugins, popoverButtons } = await import("../mod/src/renderer/registry.ts");
const { patches } = await import("../mod/src/renderer/webpack.ts");

const h = React.createElement;
const channel = { id: "1" };
/** What Discord's chat box gives its buttons, with only the channel's id. @returns {any} */
const props = (analyticsName, more = {}) => ({ channel, disabled: false, isEmpty: true, type: { analyticsName }, ...more });

/** Discord's buttons with the plugins' first, as the patched chat box renders them. */
function chatBox(chatProps) {
    const buttons = [h("span", { key: "gift" }, "regalo")];
    _injectButtons(buttons, chatProps);
    return render(h(React.Fragment, null, buttons));
}

beforeEach(() => {
    reset();
    vi.useRealTimers();
    chatBarButtons.clear();
    popoverButtons.clear();
    plugins.length = 0;
});

test("chat box: the patch puts the plugin buttons in front of Discord's, in the code that renders them", () => {
    const patch = patches.find(p => p.name === "botones de la caja de texto");
    assert.equal(patch?.find, '"sticker")');
    const code = '"sticker");return 0===n.length?null:(0,r.jsx)(l,{className:a,children:n})';
    const patched = code.replace(canonicalize(patch.match), /** @type {string} */ (patch.replace));
    assert.equal(patched, '"sticker");return (window[Symbol.for("agent-chat-bridge")]._injectButtons(n,arguments[0]),0===n.length)?null:(0,r.jsx)(l,{className:a,children:n})');
});

test("chat box: each plugin's button renders with whether the chat is the main one or any chat, before Discord's", () => {
    const seen = [];
    chatBarButtons.set("Uno", p => (seen.push(["Uno", p.isMainChat, p.isAnyChat, p.channel.id]), h("b", null, "uno")));
    chatBarButtons.set("Dos", p => (seen.push(["Dos", p.isMainChat, p.isAnyChat]), null));
    const { container } = chatBox(props("normal"));
    assert.equal(container.textContent, "unoregalo");
    for (const name of ["sidebar", "thread_creation"]) chatBox(props(name));
    assert.deepEqual(seen, [["Uno", true, true, "1"], ["Dos", true, true], ["Uno", false, true, "1"], ["Dos", false, true], ["Uno", false, false, "1"], ["Dos", false, false]]);
});

test("chat box: a disabled box, or one with no buttons of Discord's, gets none", () => {
    chatBarButtons.set("Uno", () => h("b", null, "uno"));
    assert.equal(chatBox(props("normal", { disabled: true })).container.textContent, "regalo");
    const empty = [];
    _injectButtons(empty, props("normal"));
    assert.deepEqual(empty, []);
});

test("chat box: a plugin button that throws leaves the others, and the user is told once", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    chatBarButtons.set("Roto", () => {
        throw new Error("boom");
    });
    chatBarButtons.set("Bien", () => h("b", null, "bien"));
    assert.equal(chatBox(props("normal")).container.textContent, "bienregalo");
    await vi.runAllTimersAsync();
    assert.deepEqual(showToast.mock.calls, [[{ text: "Roto no se pudo mostrar; el detalle está en la consola", variant: "critical" }]]);
    assert.ok(error.mock.calls.some(([text]) => text === "[agent-chat-bridge] Roto failed"));
});

/** A plugin whose chat box button is a ChatBarButton, registered as mod/src/renderer/index.ts does. */
function registerButton(name, buttonProps) {
    const settings = definePluginSettings({ on: { type: 2, description: "Activado", default: true } });
    settings.pluginName = name;
    plugins.push(/** @type {any} */ ({ name, description: "", settings }));
    chatBarButtons.set(name, () => h(ChatBarButton, buttonProps, h("svg", { "data-icon": name })));
}

test("chat box button: a named button, with Discord's classes, its icon inside, and the click its plugin's", () => {
    const onClick = vi.fn();
    registerButton("Uno", { tooltip: "Hacer algo", onClick });
    chatBox(props("normal"));
    const button = $("[role=button]");
    assert.equal(button.getAttribute("aria-label"), "Hacer algo");
    assert.equal(button.className, "button_button button_buttonContainer");
    assert.equal(button.parentElement.className, "expression-picker-chat-input-button buttonContainer_buttonContainer");
    assert.ok($(".buttonWrapper_button > [data-icon=Uno]", button), "the icon, in Discord's wrapper");
    mouse(button);
    assert.equal(onClick.mock.calls.length, 1);
});

test("chat box button: its tooltip says a right click opens the settings, and the right click opens them at its plugin", () => {
    registerButton("Uno", { tooltip: "Uno", onClick: () => { } });
    registerButton("Dos", { tooltip: "Dos", onClick: () => { } });
    chatBox(props("normal"));
    assert.deepEqual($$("[data-tooltip]").map(t => t.dataset.tooltip), ["Uno · clic derecho: ajustes", "Dos · clic derecho: ajustes"]);
    mouse($$("[role=button]")[1], "contextmenu");
    assert.equal($("[role=tab][aria-selected=true]")?.textContent, "Dos");
});

test("chat box button: one with a right click of its own keeps it, and its tooltip as given", () => {
    const onContextMenu = vi.fn();
    registerButton("Uno", { tooltip: "Uno", onClick: () => { }, onContextMenu });
    chatBox(props("normal"));
    assert.equal($("[data-tooltip]").dataset.tooltip, "Uno");
    mouse($("[role=button]"), "contextmenu");
    assert.equal(onContextMenu.mock.calls.length, 1);
    assert.ok(!$("[role=dialog]"), "no settings");
});

test("message toolbar: the patch puts the plugin buttons before Discord's reaction button, with its button component", () => {
    const patch = patches.find(p => p.name === "botonera del mensaje");
    assert.equal(patch?.find, ".Lv7LxN),children");
    const code = "(s.Z,{label:L}):null,a?(0,r.jsx)(r.Fragment,{children:[(0,r.jsx)(m,{message:t})]}),(0,r.jsx)(u,{togglePopout:p.q})]}):null,x";
    const patched = code.replace(canonicalize(patch.match), /** @type {any} */ (patch.replace));
    assert.equal(patched, "(s.Z,{label:L}):null,a?(0,r.jsx)(r.Fragment,{children:[(0,r.jsx)(m,{message:t})]})]}):null,"
        + 'window[Symbol.for("agent-chat-bridge")]._buildPopoverElements(s.Z,t),a?(0,r.jsx)(u,{togglePopout:p.q}):null,x');
});

/** Discord's toolbar button, as plain as it can be. @type {any} */
const Button = ({ label, onClick }) => h("button", { onClick }, label);
const message = /** @type {any} */ ({ id: "10", content: "hola" });

test("message toolbar: each plugin's item renders as Discord's button; a plugin with none for that message renders nothing", () => {
    const onClick = vi.fn();
    popoverButtons.set("Uno", m => ({ label: `uno ${m.id}`, icon: () => null, onClick }));
    popoverButtons.set("Dos", () => null);
    const { container } = render(_buildPopoverElements(Button, message));
    assert.deepEqual($$("button", container).map(b => b.textContent), ["uno 10"]);
    mouse($("button", container));
    assert.equal(onClick.mock.calls.length, 1);
});

test("message toolbar: an item that fails to build or to render leaves the others, and the user is told once each", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    popoverButtons.set("Falla", () => {
        throw new Error("boom");
    });
    popoverButtons.set("Pinta", () => ({ label: "x", icon: () => null }));
    popoverButtons.set("Bien", () => ({ label: "bien", icon: () => null }));
    const Breaks = item => {
        if (item.label === "x") throw new Error("render");
        return h(Button, item);
    };
    const { container } = render(_buildPopoverElements(Breaks, message));
    assert.equal(container.textContent, "bien");
    await vi.runAllTimersAsync();
    assert.deepEqual(showToast.mock.calls.map(([t]) => t.text), [
        "Falla no se pudo mostrar; el detalle está en la consola", "Pinta no se pudo mostrar; el detalle está en la consola"
    ]);
    assert.ok(error.mock.calls.some(([text]) => text === "[agent-chat-bridge] Falla failed"));
});
