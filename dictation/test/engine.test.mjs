// One dictation (dictation/src/engine.ts) on a fake transcriber: what it asks for, in what order, and what it emits.
import assert from "node:assert/strict";

import { test } from "vitest";

import { Dictation } from "../src/engine.ts";

const FRAME = 480;
const tone = (frames, amplitude = 0.1) => Float32Array.from({ length: frames * FRAME }, (_, i) => i % 2 ? amplitude : -amplitude);
const room = frames => tone(frames, 0.0004);
const tick = () => new Promise(r => setTimeout(r, 0));

/** A transcriber whose answers the test releases one by one; it records each request's length and prompt. */
function fakeTranscriber() {
    const calls = [];
    return {
        calls,
        transcribe: (samples, prompt) => new Promise((resolve, reject) => calls.push({ frames: samples.length / FRAME, prompt, resolve, reject })),
        /** Answers the oldest unanswered request. */
        async answer(text) {
            const call = calls.find(c => !c.done);
            call.done = true;
            call.resolve(text);
            await tick();
        },
        async fail(err) {
            const call = calls.find(c => !c.done);
            call.done = true;
            call.reject(err);
            await tick();
        }
    };
}

function dictation(transcriber, options = {}) {
    const out = [];
    const d = new Dictation(transcriber, {
        prompt: "Hablamos de git, commit, push y Claude Code.",
        replacements: [["griscord", "Discord"]],
        onPartial: text => out.push(`partial: ${text}`),
        onFinal: text => out.push(`final: ${text}`),
        onError: err => out.push(`error: ${err instanceof Error ? err.message : err}`),
        ...options
    });
    return { d, out };
}

test("engine: a partial every half second of the open phrase, then its final at the pause", async () => {
    const t = fakeTranscriber();
    const { d, out } = dictation(t);
    d.push(room(30));
    d.push(tone(11));
    assert.equal(t.calls.length, 0);
    d.push(tone(1));
    // 5 lead frames and 12 of speech: half a second.
    assert.deepEqual(t.calls.map(c => [c.frames, c.prompt]), [[17, "Hablamos de git, commit, push y Claude Code."]]);
    await t.answer("Abre griscord");
    d.push(tone(17));
    assert.equal(t.calls.at(-1).frames, 34);
    await t.answer("Abre Griscord ya");
    d.push(room(20));
    assert.equal(t.calls.at(-1).frames, 5 + 29 + 5);
    await t.answer("Abre Griscord ya.");
    assert.deepEqual(out, ["partial: Abre Discord", "partial: Abre Discord ya", "final: Abre Discord ya."]);
});

test("engine: one transcription at a time, and closed phrases before partials", async () => {
    const t = fakeTranscriber();
    const { d, out } = dictation(t);
    d.push(room(30));
    d.push(tone(17));
    // While the partial runs, two phrases close and the third is open.
    d.push(room(20));
    d.push(tone(30));
    d.push(room(20));
    d.push(tone(40));
    assert.equal(t.calls.length, 1);
    await t.answer("uno");
    assert.equal(t.calls.length, 2);
    await t.answer("uno.");
    await t.answer("dos.");
    // Then a partial of the open phrase, which grew past half a second meanwhile.
    assert.equal(t.calls.at(-1).frames, 45);
    await t.answer("tres");
    assert.deepEqual(out, ["partial: uno", "final: uno.", "final: dos.", "partial: tres"]);
});

test("engine: a final that is the prompt said back is transcribed again without it; a partial is skipped", async () => {
    const t = fakeTranscriber();
    const { d, out } = dictation(t);
    d.push(room(30));
    d.push(tone(17));
    await t.answer("git, commit, push y Claude");
    d.push(room(20));
    await t.answer("Hablamos de git, commit, push");
    assert.equal(t.calls.at(-1).prompt, null);
    await t.answer("Hice push.");
    assert.deepEqual(out, ["final: Hice push."]);
});

test("engine: without words there is no prompt, and an answer is never taken for an echo", async () => {
    const t = fakeTranscriber();
    const { d, out } = dictation(t, { prompt: null });
    d.push(room(30));
    d.push(tone(20));
    d.push(room(20));
    assert.equal(t.calls[0].prompt, null);
    await t.answer("");
    await t.answer("Hablamos de git, commit, push");
    assert.deepEqual(out, ["final: Hablamos de git, commit, push"]);
    assert.equal(t.calls.length, 2);
});

test("engine: stop() closes the open phrase and resolves once its final is out; later audio is ignored", async () => {
    const t = fakeTranscriber();
    const { d, out } = dictation(t);
    d.push(room(30));
    d.push(tone(10));
    let stopped = false;
    const stop = d.stop().then(() => stopped = true);
    // A whole phrase after stop(): it never gets transcribed.
    d.push(tone(100));
    d.push(room(20));
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].frames, 15);
    await tick();
    assert.equal(stopped, false);
    await t.answer("Vale.");
    await stop;
    assert.deepEqual(out, ["final: Vale."]);
    await d.stop();
    assert.equal(t.calls.length, 1);
});

test("engine: stop() with nothing said resolves at once, and waits for a transcription in progress", async () => {
    const t = fakeTranscriber();
    const { d } = dictation(t);
    d.push(room(30));
    await d.stop();

    const busy = dictation(t);
    busy.d.push(room(30));
    busy.d.push(tone(17));
    let stopped = false;
    const stop = busy.d.stop().then(() => stopped = true);
    await tick();
    assert.equal(stopped, false);
    await t.answer("hola");
    // The open phrase closes at stop(), and its final comes after the partial.
    await t.answer("hola.");
    await stop;
    assert.deepEqual(busy.out, ["partial: hola", "final: hola."]);
});

test("engine: a failure ends the dictation, drops the rest, and is reported once", async () => {
    const t = fakeTranscriber();
    const { d, out } = dictation(t);
    d.push(room(30));
    d.push(tone(20));
    d.push(room(20));
    d.push(tone(20));
    d.push(room(20));
    await t.fail(new Error("worker exited"));
    d.push(tone(40));
    await d.stop();
    assert.deepEqual(out, ["error: worker exited"]);
    assert.equal(t.calls.length, 1);
});

test("engine: cancel() drops the phrases waiting, lets the one in progress finish, and ignores later audio", async () => {
    const t = fakeTranscriber();
    const { d, out } = dictation(t);
    d.push(room(30));
    d.push(tone(20));
    d.push(room(20));
    d.push(tone(20));
    d.push(room(20));
    d.push(tone(10));
    // The partial of the first phrase is in progress, both phrases' finals are waiting, and a third is open.
    d.cancel();
    d.push(tone(40));
    await t.answer("uno");
    assert.deepEqual(out, ["partial: uno"]);
    // stop() after it closes nothing: the open phrase went with the cancel.
    const stop = d.stop();
    assert.equal(t.calls.length, 1);
    await stop;
});
