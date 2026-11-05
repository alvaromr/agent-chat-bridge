// The Dictation plugin's main-process side (plugins/dictation/main.ts), with the engine and the worker faked and a
// made-up Hugging Face cache: what the page may ask for, one dictation at a time, its events, and the worker kept
// while it is used and closed when idle. Run with `pnpm test`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeEach, test, vi } from "vitest";

/** The engines made, with their options and what they were given; the workers started. @type {any} */
const fake = vi.hoisted(() => ({ engines: [], workers: [], venv: true }));
vi.mock("../dictation/src/engine.ts", () => ({
    Dictation: class {
        /** @type {any[]} */
        pushed = [];
        cancelled = 0;
        /** @type {any} */
        stopping = null;
        constructor(transcriber, options) {
            Object.assign(this, { transcriber, options });
            fake.engines.push(this);
        }
        push(samples) {
            this.pushed.push(samples);
        }
        stop() {
            return new Promise(resolve => void (this.stopping = resolve));
        }
        cancel() {
            this.cancelled++;
        }
    }
}));
vi.mock("../dictation/src/worker.ts", () => ({
    startWorker: (dir, modelPath, language) => {
        const worker = { dir, modelPath, language, closed: 0, transcribe: async (samples, prompt) => `${samples.length}:${prompt}`, close: () => void worker.closed++ };
        const started = { worker, ready: null, fail: null };
        started.promise = new Promise((resolve, reject) => Object.assign(started, { ready: () => resolve(worker), fail: reject }));
        fake.workers.push(started);
        return started.promise;
    }
}));
vi.mock("fs", async original => {
    const fs = /** @type {any} */ (await original());
    return { ...fs, existsSync: path => String(path).endsWith("worker/.venv/bin/python") ? fake.venv : fs.existsSync(path) };
});

// A Hugging Face cache with two whole Whisper models.
const hub = mkdtempSync(join(tmpdir(), "agent-chat-bridge-hub-"));
afterAll(() => rmSync(hub, { recursive: true, force: true }));
for (const id of ["whisper-large-v3-turbo", "whisper-small"]) {
    const dir = join(hub, `models--mlx-community--${id}`);
    mkdirSync(join(dir, "refs"), { recursive: true });
    mkdirSync(join(dir, "snapshots/abc"), { recursive: true });
    writeFileSync(join(dir, "refs/main"), "abc");
    writeFileSync(join(dir, "snapshots/abc/config.json"), "{}");
    writeFileSync(join(dir, "snapshots/abc/weights.safetensors"), "");
}
process.env.HF_HUB_CACHE = hub;
const TURBO = join(hub, "models--mlx-community--whisper-large-v3-turbo/snapshots/abc");

const { IPC } = await import("../mod/src/ipc.ts");
// Typed loosely: the events and requests are made up, with only what the handlers read.
const main = /** @type {any} */ (await import("../plugins/dictation/main.ts"));

/** A page that talks to the dictation: its events. */
function page() {
    const events = [];
    return { events, sender: { send: (channel, event) => void (channel === IPC.dictationEvent && events.push(event)) } };
}
const request = (fields = {}) => ({ model: "mlx-community/whisper-large-v3-turbo", language: "es", vocabulary: "git, Claude", replacements: "", ...fields });
const lastEngine = () => fake.engines.at(-1);

let tab;
beforeEach(() => {
    vi.useFakeTimers();
    fake.venv = true;
    tab = page();
    main.cancelDictation(tab);
});

test("dictation main: the models on disk, by id", () => {
    const event = { returnValue: undefined };
    main.dictationModels(/** @type {any} */ (event));
    assert.deepEqual(event.returnValue, ["mlx-community/whisper-large-v3-turbo", "mlx-community/whisper-small"]);
});

test("dictation main: a request outside its shape, or too long, starts nothing", () => {
    const invalid = { ok: false, error: "Parámetros no válidos" };
    for (const req of [null, request({ model: 1 }), request({ language: "ES" }), request({ language: "e" }), request({ language: "spa1" }),
        request({ language: "1es" }), request({ language: ["es"] }),
        request({ vocabulary: 1 }), request({ vocabulary: "x".repeat(4001) }), request({ replacements: null }), request({ replacements: "x".repeat(4001) })])
        assert.deepEqual(main.startDictation(tab, req), invalid, JSON.stringify(req)?.slice(0, 60));
    assert.equal(main.startDictation(tab, request({ language: "spa", vocabulary: "x".repeat(4000), replacements: `a => ${"b".repeat(3995)}` })).ok, true,
        "at the limits");
    assert.equal(fake.engines.length, 1);
});

test("dictation main: without the worker installed, a model not on disk, or bad replacements, it says why", () => {
    fake.venv = false;
    assert.deepEqual(main.startDictation(tab, request()), { ok: false, error: "El motor de dictado no está instalado: ejecuta `pnpm setup` en el repo" });
    fake.venv = true;
    assert.deepEqual(main.startDictation(tab, request({ model: "otro/whisper" })), { ok: false, error: "El modelo otro/whisper no está descargado" });
    assert.deepEqual(main.startDictation(tab, request({ replacements: "a => b\nmal\nc => d\notra" })),
        { ok: false, error: "Sustituciones: las líneas 2, 4 no tienen la forma «oído => querido»" });
});

test("dictation main: a dictation runs on the model's worker, with the vocabulary as prompt and the replacements", async () => {
    const before = fake.workers.length;
    assert.deepEqual(main.startDictation(tab, request({ replacements: "Griscord => Discord" })), { ok: true });
    const started = fake.workers.at(-1);
    assert.equal(fake.workers.length, before + 1);
    // The repo's dictation/ folder, as the bundle in mod/dist/ finds it two levels up.
    assert.deepEqual([started.worker.dir, started.worker.modelPath, started.worker.language], [fileURLToPath(new URL("../dictation", import.meta.url)), TURBO, "es"]);
    const { options, transcriber } = lastEngine();
    assert.equal(options.prompt, "Hablamos de git y Claude.");
    assert.deepEqual(options.replacements, [["Griscord", "Discord"]]);
    started.ready();
    assert.equal(await transcriber.transcribe(new Float32Array(3), "p"), "3:p", "the engine's transcriptions go to the worker");
});

test("dictation main: the engine's texts and failures reach the page that started it", () => {
    main.startDictation(tab, request());
    const { options } = lastEngine();
    options.onPartial("ho");
    options.onFinal("hola");
    options.onError(new Error("roto"));
    options.onError("texto");
    assert.deepEqual(tab.events, [{ type: "partial", text: "ho" }, { type: "final", text: "hola" }, { type: "error", error: "roto" }, { type: "error", error: "texto" }]);
});

test("dictation main: the audio goes to the engine only from that page, as samples of at most 1 s, until stopped", async () => {
    main.startDictation(tab, request());
    const engine = lastEngine();
    const chunk = new Float32Array(1600);
    main.dictationAudio(tab, chunk);
    main.dictationAudio(page(), chunk);
    main.dictationAudio(tab, [1, 2]);
    main.dictationAudio(tab, new Float32Array(16_001));
    main.dictationAudio(tab, new Float32Array(16_000));
    assert.deepEqual(engine.pushed.map(s => s.length), [1600, 16_000]);
    main.stopDictation(page());
    main.stopDictation(tab);
    main.stopDictation(tab);
    main.dictationAudio(tab, chunk);
    assert.equal(engine.pushed.length, 2, "no audio after stop");
    assert.deepEqual(tab.events, []);
    engine.stopping();
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(tab.events, [{ type: "done" }], "done once the last phrases are out");
    main.stopDictation(tab);
    main.dictationAudio(tab, chunk);
    assert.equal(engine.pushed.length, 2, "the dictation is over");
});

test("dictation main: a new dictation cancels the page's previous one, stopped or not, whose events stop reaching it", async () => {
    main.startDictation(tab, request());
    const first = lastEngine();
    main.stopDictation(tab);
    main.startDictation(tab, request());
    assert.equal(first.cancelled, 1);
    first.options.onFinal("viejo");
    first.stopping();
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(tab.events, [], "neither its last phrase nor its end");
    const second = lastEngine();
    main.startDictation(tab, request());
    assert.equal(second.cancelled, 1);
});

test("dictation main: a cancel drops the dictation, only from its page", () => {
    main.startDictation(tab, request());
    const engine = lastEngine();
    main.cancelDictation(page());
    assert.equal(engine.cancelled, 0);
    main.cancelDictation(tab);
    assert.equal(engine.cancelled, 1);
    main.dictationAudio(tab, new Float32Array(1));
    assert.equal(engine.pushed.length, 0);
});

test("dictation main: the worker stays for the same model and language, is replaced for another, and closes after 60 s idle", async () => {
    main.startDictation(tab, request());
    const kept = fake.workers.at(-1);
    kept.ready();
    main.startDictation(tab, request());
    assert.equal(fake.workers.at(-1), kept, "the same worker");
    main.cancelDictation(tab);
    await vi.advanceTimersByTimeAsync(59_999);
    assert.equal(kept.worker.closed, 0);
    main.startDictation(tab, request());
    main.cancelDictation(tab);
    await vi.advanceTimersByTimeAsync(59_999);
    assert.equal(kept.worker.closed, 0, "a new dictation restarts the wait");
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(kept.worker.closed, 1);
    main.startDictation(tab, request({ language: "en" }));
    const english = fake.workers.at(-1);
    assert.notEqual(english, kept);
    english.ready();
    main.startDictation(tab, request({ model: "mlx-community/whisper-small" }));
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(english.worker.closed, 1, "another model closes the previous worker");
    main.cancelDictation(tab);
    main.cancelDictation(tab);
    await vi.advanceTimersByTimeAsync(60_000);
});

test("dictation main: a worker that fails to start is forgotten, so the next dictation starts another", async () => {
    main.startDictation(tab, request({ language: "fr" }));
    const failed = fake.workers.at(-1);
    failed.fail(new Error("no arranca"));
    await vi.advanceTimersByTimeAsync(0);
    main.startDictation(tab, request({ language: "fr" }));
    assert.notEqual(fake.workers.at(-1), failed);
    const retried = fake.workers.at(-1);
    main.startDictation(tab, request({ language: "de" }));
    const current = fake.workers.length;
    retried.fail(new Error("tampoco"));
    await vi.advanceTimersByTimeAsync(0);
    main.startDictation(tab, request({ language: "de" }));
    assert.equal(fake.workers.length, current, "a failure of an older worker leaves the current one");
});

test("dictation main: after a dictation's done, its worker also closes when idle", async () => {
    main.startDictation(tab, request({ language: "it" }));
    const started = fake.workers.at(-1);
    started.ready();
    main.stopDictation(tab);
    lastEngine().stopping();
    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(started.worker.closed, 1);
});
