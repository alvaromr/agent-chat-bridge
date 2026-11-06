// @vitest-environment happy-dom
// The settings modal (mod/src/renderer/SettingsModal.tsx) on a fake Discord: one tab per plugin with settings, opened at
// the plugin asked for, WAI-ARIA's tabs pattern, a named field per setting, and what Save and Cancel do. Run with
// `pnpm test`.
import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

import { $, $$, keydown, mouse, text, toggle, type } from "./dom.mjs";
import { openModal, reset, showToast } from "./fake-discord.mjs";
import { main, native } from "./fake-native.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

const { definePluginSettings } = await import("../mod/src/plugin-api/settings.ts");
const { plugins } = await import("../mod/src/renderer/registry.ts");
const { savedSettings } = await import("../mod/src/renderer/settings.ts");
const { patches } = await import("../mod/src/renderer/webpack.ts");
const { openSettingsModal } = await import("../mod/src/renderer/SettingsModal.tsx");

// OptionType of mod/src/plugin-api/plugin.ts, a const enum.
const STRING = 0, NUMBER = 1, BOOLEAN = 2;

/** @returns {any} */
function plugin(name, def) {
    const settings = definePluginSettings(def);
    settings.pluginName = name;
    return { name, description: `Qué hace ${name}`, settings };
}

beforeEach(() => {
    reset();
    native.setSettings.mockClear();
    patches.length = 0;
    plugins.length = 0;
    for (const key of Object.keys(savedSettings)) delete savedSettings[key];
    plugins.push(
        plugin("Uno", {
            on: { type: BOOLEAN, description: "Activado", default: true },
            count: { type: NUMBER, description: "Cuántos", default: 3 }
        }),
        { name: "SinAjustes", description: "" },
        plugin("Dos", {
            notes: { type: STRING, description: "Notas", default: "", multiline: true },
            line: { type: STRING, description: "Línea", default: "a" },
            pick: { type: STRING, description: "Modelo", default: "m1", options: () => ["m1", "m2"] }
        }),
        plugin("Tres", { x: { type: BOOLEAN, description: "Equis", default: false } })
    );
});

const dialog = () => $("[role=dialog]");
const tabs = () => $$("[role=tab]");
const selected = () => $("[role=tab][aria-selected=true]");
const panel = () => $("[role=tabpanel]");
const field = label => $$("label").find(l => $(".dm-label", l)?.textContent === label)?.querySelector("input, textarea, select");
const button = name => $$("button").find(b => b.textContent === name);

test("settings: a tab per plugin with settings, opened at the plugin asked for or at the first", () => {
    openSettingsModal("Dos");
    assert.deepEqual(tabs().map(t => t.textContent), ["Uno", "Dos", "Tres"]);
    assert.equal(selected().textContent, "Dos");
    mouse(button("Cancelar"));
    for (const asked of [undefined, "Nadie", "SinAjustes"]) {
        openSettingsModal(asked);
        assert.equal(selected().textContent, "Uno", String(asked));
        mouse(button("Cancelar"));
    }
});

test("settings: the tabs and their panel are tied together as WAI-ARIA's tabs pattern asks, with one tab in the Tab order", () => {
    openSettingsModal("Dos");
    assert.equal($(".dm-tabs").getAttribute("role"), "tablist");
    assert.deepEqual(tabs().map(t => [t.id, t.getAttribute("aria-controls"), t.getAttribute("aria-selected"), t.tabIndex, t.type]), [
        ["dm-tab-Uno", "dm-panel-Uno", "false", -1, "button"],
        ["dm-tab-Dos", "dm-panel-Dos", "true", 0, "button"],
        ["dm-tab-Tres", "dm-panel-Tres", "false", -1, "button"]
    ]);
    assert.deepEqual([panel().id, panel().getAttribute("aria-labelledby")], ["dm-panel-Dos", "dm-tab-Dos"]);
    assert.equal($$("[role=tabpanel]").length, 1);
    assert.equal(text($(".dm-muted", panel())), "Qué hace Dos");
});

test("settings: the arrows move to the next or previous tab, wrapping, and Home and End to the ends; the focus follows", () => {
    openSettingsModal("Uno");
    const steps = [["ArrowRight", "Dos"], ["ArrowRight", "Tres"], ["ArrowRight", "Uno"], ["ArrowLeft", "Tres"], ["ArrowLeft", "Dos"],
        ["Home", "Uno"], ["End", "Tres"]];
    for (const [key, to] of steps) {
        const event = keydown(selected(), key);
        assert.equal(event.defaultPrevented, true, String(key));
        assert.equal(selected().textContent, to, String(key));
        assert.ok(document.activeElement === selected(), String(key));
        assert.equal(panel().id, `dm-panel-${to}`, String(key));
    }
    const other = keydown(selected(), "a");
    assert.equal(other.defaultPrevented, false);
    assert.equal(selected().textContent, "Tres");
});

test("settings: a click selects a tab", () => {
    openSettingsModal();
    mouse(tabs()[2]);
    assert.equal(selected().textContent, "Tres");
});

test("settings: a plugin that can't work here says why atop its tab, above its description; one that can, nothing", () => {
    const [uno, , dos] = /** @type {any[]} */ (plugins);
    uno.notice = () => null;
    dos.notice = () => "No funciona aquí: instala lo que falta";
    openSettingsModal("Uno");
    assert.equal($(".dm-notice", panel()), null);
    mouse(tabs()[1]);
    assert.deepEqual([...panel().querySelectorAll("p")].map(p => [p.className, p.textContent]),
        [["dm-notice", "No funciona aquí: instala lo que falta"], ["dm-muted", "Qué hace Dos"]]);
    mouse(tabs()[2]);
    assert.equal($(".dm-notice", panel()), null, "without a notice() at all");
});

test("settings: each setting is a field named by its description, checkbox, number, text or a list of options", () => {
    openSettingsModal("Uno");
    assert.equal(field("Activado").type, "checkbox");
    assert.equal(field("Activado").checked, true);
    assert.equal(field("Activado").closest(".dm-field").className, "dm-field dm-check");
    assert.deepEqual([field("Cuántos").type, field("Cuántos").value, field("Cuántos").min], ["number", "3", "0"]);
    assert.equal(field("Cuántos").closest(".dm-field").className, "dm-field");
    mouse(tabs()[1]);
    assert.equal(field("Notas").tagName, "TEXTAREA");
    assert.equal(field("Notas").getAttribute("rows"), "6");
    assert.equal(field("Línea").getAttribute("rows"), "1");
    assert.equal(field("Línea").value, "a");
    const pick = field("Modelo");
    assert.equal(pick.tagName, "SELECT");
    assert.deepEqual([...pick.options].map(o => [o.value, o.textContent]), [["m1", "m1"], ["m2", "m2"]]);
});

test("settings: a saved value no longer offered stays selectable, so opening the modal doesn't change it", () => {
    savedSettings.Dos = { pick: "viejo" };
    openSettingsModal("Dos");
    assert.deepEqual([...field("Modelo").options].map(o => o.value), ["m1", "m2", "viejo"]);
    assert.equal(field("Modelo").value, "viejo");
});

test("settings: a value off its default gets a reset button, which puts the default back", () => {
    openSettingsModal("Uno");
    assert.equal(button("Restablecer"), undefined);
    toggle(field("Activado"));
    assert.equal(field("Activado").checked, false);
    assert.equal($$(".dm-reset").length, 1);
    mouse(button("Restablecer"));
    assert.equal(field("Activado").checked, true);
    assert.equal(button("Restablecer"), undefined);
});

test("settings: Save keeps only the values off their default, per plugin, saves them, says so and closes", async () => {
    savedSettings.Tres = { x: true };
    openSettingsModal("Uno");
    type(field("Cuántos"), "7");
    mouse(tabs()[1]);
    type(field("Línea"), "b");
    type(field("Modelo"), "m2");
    mouse(tabs()[2]);
    toggle(field("Equis"));
    mouse(button("Guardar"));
    await vi.waitFor(() => assert.ok(!dialog(), "the modal closed"));
    assert.deepEqual(main.settings, { Uno: { count: 7 }, Dos: { line: "b", pick: "m2" } });
    assert.equal(native.setSettings.mock.calls.length, 1);
    assert.deepEqual(showToast.mock.calls, [[{ text: "Ajustes guardados", variant: "success" }]]);
});

test("settings: a change goes only to its plugin, even when another has a setting of the same key", async () => {
    plugins.push(plugin("Cuatro", { on: { type: BOOLEAN, description: "También", default: true } }));
    openSettingsModal("Uno");
    toggle(field("Activado"));
    mouse(button("Guardar"));
    await vi.waitFor(() => assert.ok(!dialog(), "the modal closed"));
    assert.deepEqual(main.settings, { Uno: { on: false } });
});

test("settings: an emptied number field counts as 0", () => {
    openSettingsModal("Uno");
    type(field("Cuántos"), "");
    assert.equal(field("Cuántos").value, "0");
});

test("settings: a save that fails says why and leaves the modal open", async () => {
    native.setSettings.mockRejectedValueOnce(new Error("disco lleno"));
    openSettingsModal("Uno");
    mouse(button("Guardar"));
    await vi.waitFor(() => assert.equal(showToast.mock.calls.length, 1));
    assert.deepEqual(showToast.mock.calls, [[{ text: "No se pudieron guardar los ajustes: Error: disco lleno", variant: "critical" }]]);
    assert.ok(dialog(), "the modal stays open");
});

test("settings: Cancel closes without saving", () => {
    openSettingsModal("Uno");
    toggle(field("Activado"));
    mouse(button("Cancelar"));
    assert.ok(!dialog(), "the modal closed");
    assert.equal(native.setSettings.mock.calls.length, 0);
});

test("settings: the title names the mod, and the subtitle each patch with whether it applied", () => {
    patches.push(/** @type {any} */ ({ name: "a", status: "ok" }), /** @type {any} */ ({ name: "b", status: "failed" }), /** @type {any} */ ({ name: "c" }));
    openSettingsModal();
    assert.equal(dialog().getAttribute("aria-label"), "Ajustes de agent-chat-bridge");
    assert.equal(text($("p", dialog())), "Parches: a ✓ · b ✗ falló · c pendiente");
    assert.equal(button("Guardar").dataset.variant, "primary");
    assert.equal(button("Cancelar").dataset.variant, "secondary");
    assert.equal(openModal.mock.calls.length, 1);
});
