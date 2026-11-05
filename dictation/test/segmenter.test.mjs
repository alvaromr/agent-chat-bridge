// The phrase splitter (dictation/src/segmenter.ts), on synthetic audio: a room hum, and tones as speech.
import assert from "node:assert/strict";

import { test } from "vitest";

import { SAMPLE_RATE, Segmenter } from "../src/segmenter.ts";

/** The splitter's frame: 30 ms. */
const FRAME = 480;
/** A tone at this amplitude for this many frames, the same level in every frame: speech at 0.1 (-20 dB). */
const tone = (frames, amplitude = 0.1) => Float32Array.from({ length: frames * FRAME }, (_, i) => i % 2 ? amplitude : -amplitude);
/** The room: a hum at -68 dB. */
const room = frames => tone(frames, 0.0004);
const silence = frames => new Float32Array(frames * FRAME);
const concat = (...parts) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
};
const framesOf = audio => audio.length / FRAME;

/** Every phrase the audio gives, flush included, in frames. */
function phrases(audio, chunk = audio.length) {
    const s = new Segmenter();
    const out = [];
    for (let i = 0; i < audio.length; i += chunk) out.push(...s.push(audio.subarray(i, i + chunk)));
    const last = s.flush();
    if (last) out.push(last);
    return out.map(framesOf);
}

test("segmenter: speaks at 16 kHz, the rate Whisper takes", () => {
    assert.equal(SAMPLE_RATE, 16_000);
});

test("segmenter: a pause of 20 frames (0.6 s) closes the phrase, with 5 frames (150 ms) of margin on each side", () => {
    const s = new Segmenter();
    assert.deepEqual(s.push(concat(room(30), tone(30), room(19))), []);
    assert.deepEqual(s.push(room(1)).map(framesOf), [5 + 30 + 5]);
    assert.equal(s.flush(), null);
});

test("segmenter: phrases come out in order, each at its pause", () => {
    assert.deepEqual(phrases(concat(room(30), tone(30), room(25), tone(60, 0.05), room(30))), [40, 70]);
});

test("segmenter: a pause shorter than 20 frames keeps the phrase open", () => {
    assert.deepEqual(phrases(concat(room(30), tone(30), room(19), tone(30), room(30))), [5 + 79 + 5]);
});

test("segmenter: audio in odd chunks gives the same phrases as in one piece", () => {
    const audio = concat(room(30), tone(30), room(25), tone(45), room(30));
    assert.deepEqual(phrases(audio, 1001), phrases(audio));
    assert.deepEqual(phrases(audio, 1001), [40, 55]);
});

test("segmenter: less than 10 frames (0.3 s) of speech is a noise, and is dropped", () => {
    assert.deepEqual(phrases(concat(room(30), tone(9), room(30))), []);
    assert.deepEqual(phrases(concat(room(30), tone(10), room(30))), [20]);
});

test("segmenter: a sound that never gets 25 dB over the room is a noise, and is dropped", () => {
    // 14 dB and 24 dB over the room: speech frames for the 12 dB threshold, but under the 25 dB peak; 26 dB is over it.
    assert.deepEqual(phrases(concat(room(30), tone(30, 0.002), room(30))), []);
    assert.deepEqual(phrases(concat(room(30), tone(30, 0.0063), room(30))), []);
    assert.deepEqual(phrases(concat(room(30), tone(30, 0.008), room(30))), [40]);
});

test("segmenter: nothing is speech until the room has been heard", () => {
    assert.deepEqual(phrases(tone(30)), []);
    assert.deepEqual(phrases(concat(room(1), tone(30), room(30))), [1 + 30 + 5]);
});

test("segmenter: the microphone's digital silence is not the room", () => {
    // With the zeros as the floor, the hum would be 200 dB over it, and speech.
    assert.deepEqual(phrases(concat(silence(30), room(60))), []);
    assert.deepEqual(phrases(concat(silence(30), room(30), tone(30), room(30))), [40]);
    // Under -100 dB is still the microphone: -110 dB sets no floor, so the tone after it is heard as the room.
    assert.deepEqual(phrases(concat(tone(30, 3e-6), tone(30), room(30))), []);
});

test("segmenter: a frame is heard as the room once, even when a dropped phrase hands its frames back", () => {
    // 20 frames of hum, then 22 of a louder hum, dropped and learned: the louder is the median. Hearing the phrase's 5
    // lead frames again would make the old hum the median, and a sound 7 dB over the louder one speech.
    const s = new Segmenter();
    s.push(concat(room(20), tone(22, 0.002)));
    assert.equal(s.flush(), null);
    s.push(tone(30, 0.0045));
    assert.equal(s.current(), null);
});

test("segmenter: the floor is the median of the room, not its quietest part", () => {
    // The room alternates -68 and -76 dB. Over the median (-68), a -60 dB sound isn't speech; over -76 it would be.
    const s = new Segmenter();
    s.push(concat(...Array.from({ length: 60 }, (_, i) => i % 2 ? tone(1, 0.00016) : room(1))));
    s.push(tone(30, 0.001));
    assert.equal(s.current(), null);
});

test("segmenter: a quiet phrase is the room getting louder, so the floor learns it", () => {
    // A hum 14 dB louder opens a phrase, which is dropped; then the louder hum is the floor, and isn't speech.
    const s = new Segmenter();
    s.push(concat(room(30), tone(100, 0.002)));
    assert.equal(s.flush(), null);
    assert.deepEqual(s.push(tone(200, 0.002)), []);
    assert.equal(s.current(), null);
});

test("segmenter: the room's last 167 frames (5 s) set the floor", () => {
    // 120 frames of the hum, then 100 of a hum 14 dB louder, learned when its phrase is dropped. Over the last 167
    // frames the louder one is the median, so a sound 10 dB over it isn't speech; over all 220 it would be.
    const s = new Segmenter();
    s.push(concat(room(120), tone(100, 0.002)));
    s.flush();
    s.push(tone(30, 0.0063));
    assert.equal(s.current(), null);

    // With 83 louder frames, the last 167 hold 84 of the old hum, which stays the median; the last 166 would not.
    const edge = new Segmenter();
    edge.push(concat(room(120), tone(83, 0.002)));
    edge.flush();
    edge.push(tone(30, 0.0045));
    assert.notEqual(edge.current(), null);
});

test("segmenter: past 500 frames (15 s) without a pause, the phrase is cut at its quietest frame of the last 100", () => {
    const quiet = tone(1, 0.03);
    // The cut lands on the quiet frame, after 5 lead frames and 420 of speech; from it on is the next phrase.
    assert.deepEqual(phrases(concat(room(30), tone(420), quiet, tone(150), room(30))), [425, 1 + 150 + 5]);
    // A dropout of digital silence is the quietest of all.
    assert.deepEqual(phrases(concat(room(30), tone(420), silence(1), tone(150), room(30))), [425, 1 + 150 + 5]);
});

test("segmenter: a cut looks only at the last 100 frames, and takes the first of equally quiet ones", () => {
    const quiet = tone(1, 0.03);
    // The quiet frame is the last one before the window, whose frames are all as loud: the cut takes its first, at 400.
    assert.deepEqual(phrases(concat(room(30), tone(394), quiet, tone(200), room(30))), [400, 200 + 5]);
});

test("segmenter: current() is the open phrase, from its first speech", () => {
    const s = new Segmenter();
    s.push(room(30));
    assert.equal(s.current(), null);
    s.push(tone(10));
    assert.equal(framesOf(s.current()), 15);
    s.push(room(30));
    assert.equal(s.current(), null);
});

test("segmenter: flush() keeps at most 5 frames after the speech, and drops what doesn't fill a frame", () => {
    const s = new Segmenter();
    s.push(concat(room(30), tone(30), room(10)));
    assert.equal(framesOf(s.flush()), 5 + 30 + 5);
    s.push(concat(tone(30), room(2), new Float32Array(100)));
    assert.equal(framesOf(s.flush()), 5 + 30 + 2);
});
