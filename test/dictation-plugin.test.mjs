// @vitest-environment happy-dom
// The Dictation plugin's renderer side (plugins/dictation/index.tsx) on a fake Discord, with the main process and the
// microphone faked: the button and its phases, the text written phrase by phrase, Escape, holding Space, and every way
// a dictation ends. Run with `pnpm test`.
import assert from "node:assert/strict";

import { beforeAll, beforeEach, test, vi } from "vitest";

import { $, keydown, mouse, render } from "./dom.mjs";
import { chatBox, ComponentDispatch, reset, showToast, state } from "./fake-discord.mjs";
import { main, native } from "./fake-native.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));
/** The microphone: each capture's callbacks and stops; `next` sets how the next one opens. @type {any} */
const mic = vi.hoisted(() => ({ captures: [], next: null }));
vi.mock("../plugins/dictation/capture.ts", () => ({
    startCapture: async (onSamples, onSound, onError) => {
        const how = mic.next ?? {};
        mic.next = null;
        await how.wait;
        if (how.fail) throw how.fail;
        const capture = { onSamples, onSound, onError, stopped: 0, stop: () => void capture.stopped++ };
        mic.captures.push(capture);
        return capture;
    }
}));

const React = await import("react");
const { act } = React;
const { savedSettings } = await import("../mod/src/renderer/settings.ts");
const { default: dictation } = await import("../plugins/dictation/index.tsx");

const toasts = () => showToast.mock.calls.map(([toast]) => toast);
// Inside act(), so the button shows each phase as it changes.
const flush = () => act(() => vi.advanceTimersByTimeAsync(1000));
const now = fn => act(() => void fn());
/** The main process sends a dictation event. */
const say = event => now(() => main.dictation?.(event));
/** The last microphone opened, whose callbacks run inside act(). */
const mic0 = () => {
    const capture = mic.captures.at(-1);
    return capture && {
        ...capture,
        get stopped() { return capture.stopped; },
        onSamples: samples => now(() => capture.onSamples(samples)),
        onSound: () => now(capture.onSound),
        onError: e => now(() => capture.onError(e))
    };
};

beforeAll(() => {
    dictation.settings.pluginName = dictation.name;
    dictation.start?.();
});
let box;
beforeEach(async () => {
    // The previous test's dictation, if any, ends: Escape, then its done.
    keydown(document.body, "Escape");
    say({ type: "done" });
    await vi.advanceTimersByTimeAsync(2000).catch(() => { });
    // What that ending sent the main process isn't this test's.
    for (const fn of Object.values(native.dictation)) /** @type {any} */ (fn).mockClear();
    reset();
    vi.useFakeTimers();
    for (const key of Object.keys(savedSettings)) delete savedSettings[key];
    mic.captures.length = 0;
    mic.next = null;
    native.dictation.start.mockImplementation(async () => ({ ok: true }));
    state.selected = "1";
    box = chatBox("");
});

/** The chat box button, rendered as Discord renders it in the main chat. */
function button() {
    render(React.createElement(/** @type {any} */ (dictation.chatBarButton?.render), { isMainChat: true, channel: { id: "1" } }));
    return $("[role=button]");
}
const label = () => $("[role=button]").getAttribute("aria-label");

test("dictation: no button outside the main chat box", () => {
    const { container } = render(React.createElement(/** @type {any} */ (dictation.chatBarButton?.render), { isMainChat: false, channel: { id: "1" } }));
    assert.equal(container.innerHTML, "");
});

test("dictation: the button opens the microphone with the settings, and shows each phase until the text is in", async () => {
    const b = button();
    assert.equal(label(), "Dictar (o mantén Espacio)");
    assert.ok($("svg.dm-dictation-idle"), "the icon shows the phase");
    mouse(b);
    assert.equal(label(), "Abriendo el micrófono…");
    await flush();
    assert.deepEqual(native.dictation.start.mock.calls[0][0], {
        model: "mlx-community/whisper-large-v3-turbo", language: "es",
        vocabulary: /** @type {any} */ (dictation.settings.def).vocabulary.default, replacements: "Griscord => Discord\nWorldtree => worktree"
    });
    mic0().onSamples(Float32Array.of(1));
    assert.deepEqual(native.dictation.audio.mock.calls, [[Float32Array.of(1)]]);
    mic0().onSound();
    await flush();
    assert.equal(label(), "Dictando: pulsa para parar, Escape cancela");
    say({ type: "partial", text: "¿Hola" });
    await flush();
    assert.equal(box.textContent, "Hola");
    say({ type: "final", text: "¿Hola, qué tal?" });
    say({ type: "partial", text: "Bien" });
    await flush();
    assert.equal(box.textContent, "Hola, qué tal? Bien");
    mouse($("[role=button]"));
    assert.equal(label(), "Terminando de transcribir…");
    assert.deepEqual([mic0().stopped, native.dictation.stop.mock.calls.length], [1, 1]);
    say({ type: "final", text: "Bien." });
    say({ type: "done" });
    await flush();
    assert.equal(box.textContent, "Hola, qué tal? Bien.");
    assert.equal(label(), "Dictar (o mantén Espacio)");
});

test("dictation: the text goes after the draft; the style settings shape it", async () => {
    savedSettings.Dictation = { noFinalPeriod: true, noSentenceCapitals: true, noOpeningMarks: false, vocabulary: "Claude" };
    box.textContent = "Antes:";
    state.drafts.set("1", "Antes:");
    mouse(button());
    await flush();
    say({ type: "final", text: "¿Vale? Claude dice. Sí." });
    await flush();
    assert.equal(box.textContent, "Antes: ¿vale? Claude dice. sí");
    mouse($("[role=button]"));
    say({ type: "done" });
    await flush();
});

test("dictation: a box the user changed, or another chat, stops the dictation and keeps what is there", async () => {
    mouse(button());
    await flush();
    say({ type: "final", text: "Uno." });
    await flush();
    state.drafts.set("1", "Uno. mío");
    say({ type: "final", text: "Dos." });
    await flush();
    assert.deepEqual(toasts().at(-1), { text: "El texto de la caja cambió durante el dictado; lo paro", variant: "critical" });
    assert.equal(label(), "Dictar (o mantén Espacio)");
    assert.equal(native.dictation.cancel.mock.calls.length, 1);
    assert.equal(mic0().stopped, 1);

    state.drafts.set("1", "");
    box.textContent = "";
    mouse($("[role=button]"));
    await flush();
    state.selected = "2";
    say({ type: "final", text: "Tres." });
    await flush();
    assert.deepEqual(toasts().at(-1), { text: "Cambiaste de chat durante el dictado; lo paro", variant: "critical" });
});

test("dictation: the same text again isn't rewritten", async () => {
    mouse(button());
    await flush();
    say({ type: "partial", text: "Hola" });
    await flush();
    const inserts = () => ComponentDispatch.dispatchToLastSubscribed.mock.calls.filter(([event]) => event === "INSERT_TEXT").length;
    const writes = inserts();
    say({ type: "partial", text: "Hola" });
    await flush();
    assert.equal(inserts(), writes);
    keydown(box, "Escape");
});

test("dictation: the engine's failure ends the dictation and says why", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    mouse(button());
    await flush();
    say({ type: "error", error: "worker exited (1)" });
    assert.deepEqual(toasts().at(-1), { text: "Dictado: worker exited (1)", variant: "critical" });
    assert.deepEqual(error.mock.calls, [["[agent-chat-bridge] Dictation failed: worker exited (1)"]]);
    assert.equal(label(), "Dictar (o mantén Espacio)");
});

test("dictation: a start the main process refuses, or a microphone that won't open or fails, says why", async () => {
    native.dictation.start.mockResolvedValueOnce({ ok: false, error: "El modelo x no está descargado" });
    mouse(button());
    await flush();
    assert.deepEqual(toasts().at(-1), { text: "Dictado: El modelo x no está descargado", variant: "critical" });
    mic.next = { fail: new Error("Permission denied") };
    mouse($("[role=button]"));
    await flush();
    assert.deepEqual(toasts().at(-1), { text: "Dictado: no se pudo abrir el micrófono: Permission denied", variant: "critical" });
    mic.next = { fail: "texto" };
    mouse($("[role=button]"));
    await flush();
    assert.deepEqual(toasts().at(-1), { text: "Dictado: no se pudo abrir el micrófono: texto", variant: "critical" });
    mouse($("[role=button]"));
    await flush();
    mic0().onError(new Error("device lost"));
    assert.deepEqual(toasts().at(-1), { text: "Dictado: no se pudo abrir el micrófono: device lost", variant: "critical" });
    assert.equal(label(), "Dictar (o mantén Espacio)");
});

test("dictation: Escape drops it and puts the box back as it was, unless the user changed it", async () => {
    box.textContent = "Antes";
    state.drafts.set("1", "Antes");
    mouse(button());
    await flush();
    say({ type: "final", text: "Dicho." });
    await flush();
    assert.equal(box.textContent, "Antes Dicho.");
    const escape = keydown(box, "Escape");
    assert.equal(escape.defaultPrevented, true);
    await flush();
    assert.equal(box.textContent, "Antes");
    say({ type: "final", text: "Tarde." });
    await flush();
    assert.equal(box.textContent, "Antes", "after Escape the engine's texts go nowhere");

    mouse($("[role=button]"));
    await flush();
    say({ type: "final", text: "Otro." });
    await flush();
    state.drafts.set("1", "cambiado");
    keydown(box, "Escape");
    await flush();
    assert.equal(state.drafts.get("1"), "cambiado");
    assert.equal(keydown(box, "Escape").defaultPrevented, false, "with nothing to cancel, Escape is Discord's");
});

test("dictation: Escape while the microphone opens leaves nothing open", async () => {
    let started = () => { };
    native.dictation.start.mockImplementationOnce(() => new Promise(resolve => void (started = () => resolve({ ok: true }))));
    mouse(button());
    keydown(box, "Escape");
    started();
    await flush();
    assert.equal(native.dictation.cancel.mock.calls.length, 2, "on Escape, and when the start comes back");
    assert.equal(mic.captures.length, 0);

    /** @type {(value?: unknown) => void} */
    let opened = () => { };
    mic.next = { wait: new Promise(resolve => void (opened = resolve)) };
    mouse($("[role=button]"));
    await flush();
    keydown(box, "Escape");
    opened();
    await flush();
    assert.equal(mic0().stopped, 1, "the microphone that opened late is closed");
});

test("dictation: a stop while the microphone opens closes it once open, and the text still comes", async () => {
    /** @type {(value?: unknown) => void} */
    let opened = () => { };
    mic.next = { wait: new Promise(resolve => void (opened = resolve)) };
    mouse(button());
    await flush();
    mouse($("[role=button]"));
    assert.equal(label(), "Terminando de transcribir…");
    opened();
    await flush();
    assert.equal(mic0().stopped, 1);
    mic0().onSound();
    assert.equal(label(), "Terminando de transcribir…", "a late sound doesn't bring back «listening»");
    say({ type: "final", text: "Hola." });
    say({ type: "done" });
    await flush();
    assert.equal(box.textContent, "Hola.");
});

test("dictation: started with the button, Space stops it, as tapping does in Claude Code", async () => {
    mouse(button());
    await flush();
    const press = keydown(box, " ", { code: "Space" });
    assert.equal(press.defaultPrevented, true);
    assert.equal(native.dictation.stop.mock.calls.length, 1);
    say({ type: "done" });
    await flush();
});

/**
 * Holds Space in the box for `presses` presses, the key's repeats after the first. A press the plugin lets through
 * types its space, as Discord would. Returns whether each press was kept out of the box.
 */
function holdSpace(presses, { from = 0, target = box } = {}) {
    const kept = [];
    for (let i = from; i < from + presses; i++) {
        const event = keydown(target, " ", { code: "Space", repeat: i > 0 });
        kept.push(event.defaultPrevented);
        if (!event.defaultPrevented && target === box) {
            box.textContent += " ";
            state.drafts.set("1", box.textContent);
        }
    }
    return kept;
}
const release = (target = box) => now(() => target.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true })));
const blur = () => now(() => window.dispatchEvent(new FocusEvent("blur")));
const write = text => {
    box.textContent = text;
    state.drafts.set("1", text);
};

test("dictation: holding Space types two spaces, opens the microphone, and dictates from the fifth press until released", async () => {
    write("Hola");
    button();
    assert.deepEqual(holdSpace(2), [false, false], "the first two spaces are typed");
    await flush();
    assert.equal(native.dictation.start.mock.calls.length, 1, "the microphone opens at the second");
    assert.equal(label(), "Abriendo el micrófono…");
    mic0().onSound();
    say({ type: "partial", text: "Mun" });
    await flush();
    assert.equal(box.textContent, "Hola  ", "nothing goes in before the fifth press");
    assert.equal(label(), "Abriendo el micrófono…", "nor is it «listening»");
    assert.deepEqual(holdSpace(3, { from: 2 }), [true, true, true]);
    await flush();
    assert.equal(label(), "Dictando: pulsa para parar, Escape cancela");
    assert.equal(box.textContent, "Hola Mun", "the two typed spaces are gone");
    assert.deepEqual(holdSpace(1, { from: 5 }), [true], "while dictating, Space types nothing");
    say({ type: "final", text: "Mundo." });
    await flush();
    release();
    assert.equal(label(), "Terminando de transcribir…");
    assert.equal(native.dictation.stop.mock.calls.length, 1);
    say({ type: "done" });
    await flush();
    assert.equal(box.textContent, "Hola Mundo.");
});

test("dictation: Space released before the fifth press closes the microphone and types the spaces kept out", async () => {
    write("Hola");
    holdSpace(4);
    await flush();
    release();
    await flush();
    assert.equal(native.dictation.cancel.mock.calls.length, 1);
    assert.equal(mic0().stopped, 1);
    assert.equal(box.textContent, "Hola    ", "two typed, two kept out and typed now");
    write("");
    holdSpace(2);
    await flush();
    release();
    assert.equal(native.dictation.cancel.mock.calls.length, 2, "at the second press too");
    assert.equal(box.textContent, "  ");
    write("");
    holdSpace(1);
    release();
    await flush();
    assert.equal(native.dictation.start.mock.calls.length, 2, "a tap is just a space");
});

test("dictation: another key, or the window losing focus, ends the hold as a release would", async () => {
    holdSpace(5);
    await flush();
    keydown(box, "a");
    assert.equal(native.dictation.stop.mock.calls.length, 1, "while dictating: stop");
    say({ type: "done" });
    await flush();
    holdSpace(3);
    await flush();
    keydown(box, "a");
    assert.equal(native.dictation.cancel.mock.calls.length, 1, "before the start: abort");
    holdSpace(5);
    await flush();
    blur();
    assert.equal(native.dictation.stop.mock.calls.length, 2);
    say({ type: "done" });
    await flush();
    write("");
    holdSpace(3);
    await flush();
    blur();
    assert.equal(native.dictation.cancel.mock.calls.length, 2);
    assert.equal(box.textContent, "  ", "losing focus types nothing");
    blur();
    holdSpace(1);
    blur();
    assert.equal(native.dictation.cancel.mock.calls.length, 2, "nothing held, or a single tap: nothing to end");
});

test("dictation: Space with a modifier, outside the chat box, or with holding turned off, doesn't dictate", async () => {
    for (const init of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }])
        for (let i = 0; i < 5; i++) keydown(box, " ", { code: "Space", repeat: i > 0, ...init });
    const edit = document.body.appendChild(Object.assign(document.createElement("div"), { id: "chat-messages-1-5" }));
    const editBox = edit.appendChild(document.createElement("div"));
    editBox.setAttribute("data-slate-editor", "true");
    holdSpace(5, { target: editBox });
    holdSpace(5, { target: document.body });
    keydown(document, " ", { code: "Space" });
    savedSettings.Dictation = { holdSpace: false };
    holdSpace(5);
    await flush();
    assert.equal(native.dictation.start.mock.calls.length, 0);
    edit.remove();
});

test("dictation: a modified Space or a Space elsewhere ends a hold in the box", async () => {
    holdSpace(3);
    await flush();
    keydown(box, " ", { code: "Space", shiftKey: true });
    assert.equal(native.dictation.cancel.mock.calls.length, 1);
});

test("dictation: a hold whose start failed keeps its spaces out, and its release has nothing to stop", async () => {
    native.dictation.start.mockResolvedValueOnce({ ok: false, error: "no" });
    holdSpace(2);
    await flush();
    assert.deepEqual(holdSpace(3, { from: 2 }), [true, true, true]);
    release();
    assert.equal(native.dictation.stop.mock.calls.length, 0);
});

test("dictation: while the last phrases come, a new hold waits for them; once done, a new dictation can start", async () => {
    mouse(button());
    await flush();
    mouse($("[role=button]"));
    holdSpace(5);
    await flush();
    assert.equal(native.dictation.start.mock.calls.length, 1);
    release();
    // The done arrives, and before its last writes land the user drops the dictation and starts another.
    say({ type: "done" });
    keydown(box, "Escape");
    mouse($("[role=button]"));
    await flush();
    assert.equal(label(), "Abriendo el micrófono…", "the new one isn't ended by the old one's done");
    assert.equal(native.dictation.start.mock.calls.length, 2);
});

test("dictation: the settings offer the models on disk, with no notice, and its icon takes the size given, 20 px by default", () => {
    assert.deepEqual(/** @type {any} */ (dictation.settings.def).model.options(), ["mlx-community/whisper-large-v3-turbo"]);
    assert.equal(dictation.notice?.(), null);
    const Icon = /** @type {any} */ (dictation.chatBarButton?.icon);
    const { container } = render(React.createElement(React.Fragment, null, React.createElement(Icon), React.createElement(Icon, { height: 16, width: 18 })));
    assert.deepEqual([...container.querySelectorAll("svg")].map(svg => [svg.getAttribute("height"), svg.getAttribute("width")]), [["20", "20"], ["16", "18"]]);
    assert.match(dictation.style ?? "", /dm-dictation-listening/);
});

test("dictation: a microphone failure after its dictation ended, or another key's release, changes nothing", async () => {
    mouse(button());
    await flush();
    const stale = mic0();
    keydown(box, "Escape");
    stale.onError(new Error("tarde"));
    assert.equal(toasts().length, 0);
    holdSpace(3);
    await flush();
    now(() => box.dispatchEvent(new KeyboardEvent("keyup", { key: "a", code: "KeyA", bubbles: true })));
    assert.equal(native.dictation.cancel.mock.calls.length, 1, "only the Escape's: the hold goes on");
    release();
});

test("dictation: each phrase is written once Discord shows the previous one, so the box never looks changed by the user", async () => {
    // Discord shows the inserted text a moment later.
    ComponentDispatch.dispatchToLastSubscribed.mockImplementation((event, { rawText }) => {
        if (event === "INSERT_TEXT") setTimeout(() => void state.drafts.set("1", rawText), 100);
    });
    mouse(button());
    await flush();
    const start = Date.now();
    say({ type: "final", text: "Uno." });
    await act(() => vi.advanceTimersByTimeAsync(300));
    assert.equal(state.drafts.get("1"), "Uno.");
    say({ type: "final", text: "Dos." });
    // Each write takes Discord's ~250 ms, not the 500 ms it would wait at most.
    await act(() => vi.advanceTimersByTimeAsync(350));
    assert.equal(state.drafts.get("1"), "Uno. Dos.", `at ${Date.now() - start} ms`);
    await flush();
    assert.equal(toasts().length, 0, "the second write knew what the first left");
    keydown(box, "Escape");
});

test("dictation: a second stop does nothing; Escape and Space taken by the dictation reach no other listener", async () => {
    const later = vi.fn();
    document.addEventListener("keydown", later, true);
    mouse(button());
    await flush();
    keydown(box, " ", { code: "Space" });
    mouse($("[role=button]"));
    assert.equal(native.dictation.stop.mock.calls.length, 1);
    keydown(box, "Escape");
    assert.equal(later.mock.calls.length, 0);
    document.removeEventListener("keydown", later, true);
});

test("dictation: it hears the keys before Discord's editor, which stops them", async () => {
    const stop = e => e.stopPropagation();
    box.addEventListener("keydown", stop);
    box.addEventListener("keyup", stop);
    holdSpace(5);
    await flush();
    assert.equal(native.dictation.start.mock.calls.length, 1);
    release();
    assert.equal(native.dictation.stop.mock.calls.length, 1, "the release too");
    say({ type: "done" });
    await flush();
});

test("dictation: an old microphone's first sound doesn't change the new dictation's phase", async () => {
    mouse(button());
    await flush();
    const old = mic0();
    keydown(box, "Escape");
    mouse($("[role=button]"));
    await flush();
    old.onSound();
    assert.equal(label(), "Abriendo el micrófono…");
});

test("dictation: a tap of Space while the button's dictation opens leaves it going when the window loses focus", async () => {
    let started = () => { };
    native.dictation.start.mockImplementationOnce(() => new Promise(resolve => void (started = () => resolve({ ok: true }))));
    holdSpace(1);
    mouse(button());
    blur();
    started();
    await flush();
    assert.equal(native.dictation.cancel.mock.calls.length, 0);
    assert.equal(mic.captures.length, 1);
});

test("dictation: a phrase still to write when the user drops the dictation isn't written", async () => {
    mouse(button());
    await flush();
    const inserts = () => ComponentDispatch.dispatchToLastSubscribed.mock.calls.filter(([event]) => event === "INSERT_TEXT").map(([, { rawText }]) => rawText);
    say({ type: "final", text: "Tarde." });
    keydown(box, "Escape");
    await flush();
    assert.deepEqual(inserts(), [""], "only the box put back as it was");
});

test("dictation: the presses a hold keeps out reach no other listener; a release at the second press types nothing", async () => {
    const later = vi.fn();
    document.addEventListener("keydown", later, true);
    holdSpace(4);
    assert.equal(later.mock.calls.length, 2, "only the two typed");
    document.removeEventListener("keydown", later, true);
    release();
    write("");
    ComponentDispatch.dispatchToLastSubscribed.mockClear();
    holdSpace(2);
    await flush();
    release();
    assert.equal(ComponentDispatch.dispatchToLastSubscribed.mock.calls.length, 0);
});

test("dictation: the engine's texts with no dictation going go nowhere", async () => {
    say({ type: "final", text: "Nada." });
    await flush();
    assert.equal(box.textContent, "");
});
