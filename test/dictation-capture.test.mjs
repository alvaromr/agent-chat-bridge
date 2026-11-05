// The Dictation plugin's microphone (plugins/dictation/capture.ts) on faked page audio APIs: the raw microphone at
// the engine's rate, its samples in 0.1 s chunks, the first real sound, and a stop that leaves nothing open. Run with
// `pnpm test`.
import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

const { startCapture } = await import("../plugins/dictation/capture.ts");

/** The page's audio, faked: what was asked for, and the frames the microphone gives, one per read. @type {any} */
let audio;
beforeEach(() => {
    audio = {
        constraints: null, rate: null, connected: null, channelCount: null, stopped: 0, closed: 0, cancelled: 0,
        frames: [], waiting: null, readError: null, closeError: null, cancelError: null
    };
    const track = { stop: () => void audio.stopped++ };
    const destination = { channelCount: 2, stream: { getAudioTracks: () => [track] } };
    vi.stubGlobal("navigator", {
        mediaDevices: { getUserMedia: async constraints => (audio.constraints = constraints, { getTracks: () => [track, track] }) }
    });
    vi.stubGlobal("AudioContext", class {
        constructor({ sampleRate }) {
            audio.rate = sampleRate;
        }
        createMediaStreamDestination() {
            audio.destination = destination;
            return destination;
        }
        createMediaStreamSource(stream) {
            return { connect: to => void (audio.connected = [stream, to]) };
        }
        close() {
            audio.closed++;
            return audio.closeError ? Promise.reject(audio.closeError) : Promise.resolve();
        }
    });
    vi.stubGlobal("MediaStreamTrackProcessor", class {
        constructor({ track: given }) {
            audio.track = given;
            this.readable = {
                getReader: () => ({
                    read: () => audio.readError ? Promise.reject(audio.readError)
                        : audio.frames.length ? Promise.resolve(audio.frames.shift())
                            : new Promise(resolve => void (audio.waiting = resolve)),
                    cancel: () => (audio.cancelled++, audio.cancelError ? Promise.reject(audio.cancelError) : Promise.resolve())
                })
            };
        }
    });
});

/** A frame of the microphone with these samples, as an AudioData. */
function frame(samples) {
    const data = { numberOfFrames: samples.length, closed: false, copied: null };
    return {
        value: Object.assign(data, {
            copyTo: (target, options) => (data.copied = options, target.set(samples)),
            close: () => void (data.closed = true)
        }),
        done: false
    };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("capture: the raw microphone, mono at 16 kHz, through the page's own audio", async () => {
    await startCapture(() => { }, () => { }, () => { });
    assert.deepEqual(audio.constraints, { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    assert.equal(audio.rate, 16_000);
    assert.equal(audio.destination.channelCount, 1);
    assert.equal(audio.connected[1], audio.destination);
    assert.equal(audio.track, audio.destination.stream.getAudioTracks()[0]);
});

test("capture: the samples come out in chunks of 0.1 s, whatever the frames' size", async () => {
    const chunks = [];
    audio.frames = [frame(new Float32Array(1000).fill(0.1)), frame(new Float32Array(1000).fill(0.2)), frame(new Float32Array(1500).fill(0.3))];
    await startCapture(samples => chunks.push(samples), () => { }, () => { });
    await tick();
    assert.deepEqual(chunks.map(c => c.length), [1600, 1600]);
    assert.deepEqual([chunks[0][999], chunks[0][1000], chunks[1][399], chunks[1][400]].map(v => Math.round(v * 10)), [1, 2, 2, 3]);
    assert.deepEqual(audio.frames, []);
});

test("capture: each frame is read as 32-bit floats of its first channel, and released", async () => {
    const first = frame(new Float32Array(10));
    audio.frames = [first];
    await startCapture(() => { }, () => { }, () => { });
    await tick();
    assert.deepEqual(first.value.copied, { planeIndex: 0, format: "f32-planar" });
    assert.equal(first.value.closed, true);
});

test("capture: the first real sound is told once; the digital silence while the microphone opens isn't sound", async () => {
    const sound = vi.fn();
    audio.frames = [frame(new Float32Array(100)), frame(new Float32Array(100).fill(0.0001)), frame(new Float32Array(100).fill(0.5))];
    await startCapture(() => { }, sound, () => { });
    await tick();
    assert.equal(sound.mock.calls.length, 1);
    const silent = vi.fn();
    audio.frames = [frame(new Float32Array(100)), frame(new Float32Array(100))];
    await startCapture(() => { }, silent, () => { });
    await tick();
    assert.equal(silent.mock.calls.length, 0, "digital silence alone is no sound");
});

test("capture: stop hands over the samples it had, and closes the reader, the microphone and the audio, once", async () => {
    const chunks = [];
    audio.frames = [frame(new Float32Array(700).fill(0.1))];
    const capture = await startCapture(samples => chunks.push(samples), () => { }, () => { });
    await tick();
    capture.stop();
    capture.stop();
    assert.deepEqual(chunks.map(c => c.length), [700]);
    assert.deepEqual([audio.cancelled, audio.stopped, audio.closed], [1, 2, 1]);
});

test("capture: a stop with nothing pending hands over nothing; a frame that arrives after it is released unread", async () => {
    const chunks = [];
    const capture = await startCapture(samples => chunks.push(samples), () => { }, () => { });
    await tick();
    capture.stop();
    const late = frame(new Float32Array(10).fill(0.5));
    audio.waiting(late);
    await tick();
    assert.deepEqual(chunks, []);
    assert.equal(late.value.closed, true);
    assert.equal(late.value.copied, null);
});

test("capture: the stream's end ends the reading", async () => {
    const chunks = [];
    audio.frames = [{ value: undefined, done: true }, frame(new Float32Array(1600))];
    await startCapture(samples => chunks.push(samples), () => { }, () => { });
    await tick();
    assert.equal(audio.frames.length, 1, "nothing read after the end");
});

test("capture: a failure reading, cancelling or closing goes to the error callback; one opening the microphone rejects", async () => {
    const errors = [];
    audio.readError = new Error("read");
    const capture = await startCapture(() => { }, () => { }, e => errors.push(/** @type {Error} */ (e).message));
    await tick();
    audio.cancelError = new Error("cancel");
    audio.closeError = new Error("close");
    capture.stop();
    await tick();
    assert.deepEqual(errors, ["read", "cancel", "close"]);
    navigator.mediaDevices.getUserMedia = async () => {
        throw new Error("NotAllowedError");
    };
    await assert.rejects(startCapture(() => { }, () => { }, () => { }), { message: "NotAllowedError" });
});
