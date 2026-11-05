// The microphone as mono samples at the engine's rate, through the page's own audio APIs: Chromium resamples to the
// AudioContext's rate, and a MediaStreamTrackProcessor hands the samples out without loading any script.
import { DIGITAL_SILENCE_DB, levelDb, SAMPLE_RATE } from "../../dictation/src/segmenter";

declare class MediaStreamTrackProcessor {
    constructor(init: { track: MediaStreamTrack; });
    readable: ReadableStream<AudioData>;
}

/** Samples per call to onSamples: 0.1 s. */
const CHUNK = SAMPLE_RATE / 10;

export interface Capture {
    stop(): void;
}

/**
 * Opens the microphone. `onSound` fires once, with the first real sound. Raw audio, without echo cancellation, noise
 * suppression or gain control: the phrase splitter's thresholds were measured on raw recordings.
 */
export async function startCapture(onSamples: (samples: Float32Array) => void, onSound: () => void, onError: (err: unknown) => void): Promise<Capture> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const destination = context.createMediaStreamDestination();
    destination.channelCount = 1;
    context.createMediaStreamSource(stream).connect(destination);
    // A MediaStreamAudioDestinationNode's stream always holds exactly one audio track.
    const reader = new MediaStreamTrackProcessor({ track: destination.stream.getAudioTracks()[0]! }).readable.getReader();

    let stopped = false, heard = false, buffer = new Float32Array(CHUNK), filled = 0;
    (async () => {
        while (!stopped) {
            const { value, done } = await reader.read();
            if (done) return;
            if (stopped) return value.close();
            const samples = new Float32Array(value.numberOfFrames);
            value.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
            value.close();
            // The microphone gives digital silence while it opens (~0.8 s, measured in Discord).
            // Stryker disable next-line EqualityOperator: > and >= part ways only on a frame at exactly -100 dB, which no microphone gives.
            if (!heard && levelDb(samples) > DIGITAL_SILENCE_DB) {
                heard = true;
                onSound();
            }
            for (let i = 0; i < samples.length;) {
                const n = Math.min(samples.length - i, CHUNK - filled);
                buffer.set(samples.subarray(i, i + n), filled);
                filled += n;
                i += n;
                if (filled === CHUNK) {
                    onSamples(buffer);
                    buffer = new Float32Array(CHUNK);
                    filled = 0;
                }
            }
        }
    })().catch(onError);

    return {
        stop() {
            if (stopped) return;
            stopped = true;
            if (filled) onSamples(buffer.slice(0, filled));
            reader.cancel().catch(onError);
            stream.getTracks().forEach(t => t.stop());
            context.close().catch(onError);
        }
    };
}
