// Splits a live 16 kHz mono stream into phrases at the speaker's pauses, by energy over the room's noise floor.
// Pure: it sees only the samples it is given.

export const SAMPLE_RATE = 16_000;
/** 30 ms. */
const FRAME = 480;
const frames = (ms: number) => Math.round(ms * SAMPLE_RATE / 1000 / FRAME);

/** Silence that closes a phrase. */
const PAUSE = frames(600);
/** Whisper's window is 30 s; past 15 s a phrase is cut at its quietest point instead of waiting for a pause. */
const MAX = frames(15_000);
/** Where to look for that point: the last 3 s. */
const CUT_WINDOW = frames(3000);
/** A phrase with less speech than this is a noise (a breath, a click) and is dropped. */
const MIN_SPEECH = frames(300);
/** Kept before the first and after the last speech frame, so word edges aren't clipped. */
const MARGIN = frames(150);
/** A frame is speech when it is this much louder than the noise floor. */
const SPEECH_OVER_FLOOR_DB = 12;
/**
 * A phrase whose loudest frame doesn't reach this over the floor is a noise, and Whisper would invent words for it
 * («Gracias.»). Measured on the user's recordings: speech peaks at 38–42 dB over the floor, breaths and clicks at 6–23.
 */
const PEAK_OVER_FLOOR_DB = 25;
/**
 * The floor is the median of the room's last 5 s: the frames that weren't speech. On the user's recordings, a lower
 * percentile took the breaths between sentences for speech, and merged the sentences.
 */
const FLOOR_WINDOW = frames(5000);
/** Below this, a frame is digital silence (the microphone still opening), not the room: it never sets the floor. */
export const DIGITAL_SILENCE_DB = -100;

/** The samples' mean power in decibels, about -300 for pure zeros. */
export const levelDb = (samples: Float32Array) => 10 * Math.log10(samples.reduce((sum, x) => sum + x * x, 0) / samples.length + 1e-30);

interface Frame {
    samples: Float32Array;
    db: number;
    /** Whether its level is already in the floor's window. */
    heard: boolean;
}

function concat(chunks: Float32Array[]) {
    const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
    }
    return out;
}

const join = (frames: Frame[]) => concat(frames.map(f => f.samples));

export class Segmenter {
    /** Samples that don't fill a frame yet. */
    private pending = new Float32Array(0);
    /** The room's recent levels: frames that weren't speech. */
    private room: number[] = [];
    /** Frames before any phrase, kept for its leading margin. */
    private lead: Frame[] = [];
    /** The open phrase, and how many of its frames were speech. */
    private phrase: Frame[] = [];
    private speech = 0;
    private silentRun = 0;

    /** Feeds samples in; returns the phrases they close, in order. */
    push(samples: Float32Array): Float32Array[] {
        const all = concat([this.pending, samples]);
        const closed: Float32Array[] = [];
        let start = 0;
        for (; start + FRAME <= all.length; start += FRAME) {
            const frame = all.slice(start, start + FRAME);
            const phrase = this.add({ samples: frame, db: levelDb(frame), heard: false });
            if (phrase) closed.push(phrase);
        }
        this.pending = all.slice(start);
        return closed;
    }

    /** The open phrase so far, for a partial transcription, or null when it has no speech yet. */
    current(): Float32Array | null {
        return this.speech ? join(this.phrase) : null;
    }

    /** Closes the open phrase at the end of the stream; null if there was none worth keeping. */
    flush(): Float32Array | null {
        this.pending = new Float32Array(0);
        return this.close(this.phrase.length - Math.max(0, this.silentRun - MARGIN));
    }

    private add(frame: Frame): Float32Array | null {
        // Stryker disable next-line EqualityOperator: levels are real numbers; none lands exactly on the threshold.
        const isSpeech = frame.db > this.floor() + SPEECH_OVER_FLOOR_DB;
        if (!isSpeech) this.hear(frame);
        if (!this.phrase.length) {
            if (!isSpeech) {
                this.lead.push(frame);
                if (this.lead.length > MARGIN) this.lead.shift();
                return null;
            }
            this.phrase = this.lead;
            this.lead = [];
        }

        this.phrase.push(frame);
        if (isSpeech) {
            this.speech++;
            this.silentRun = 0;
        } else this.silentRun++;

        if (this.silentRun >= PAUSE) return this.close(this.phrase.length - this.silentRun + MARGIN);
        if (this.phrase.length >= MAX) return this.close(this.quietestRecent());
        return null;
    }

    /** Puts the frame's level in the floor's window, once. */
    private hear(frame: Frame) {
        // Stryker disable next-line EqualityOperator: levels are real numbers; none lands exactly on the threshold.
        if (frame.heard || frame.db <= DIGITAL_SILENCE_DB) return;
        frame.heard = true;
        this.room.push(frame.db);
        if (this.room.length > FLOOR_WINDOW) this.room.shift();
    }

    /** Until the room has been heard, nothing is louder than it. */
    private floor() {
        const sorted = [...this.room].sort((a, b) => a - b);
        return sorted[sorted.length >> 1] ?? Infinity;
    }

    /** Index of the quietest frame in the last CUT_WINDOW of the open phrase. */
    private quietestRecent() {
        const start = this.phrase.length - CUT_WINDOW;
        const levels = this.phrase.slice(start).map(f => f.db);
        return start + levels.indexOf(Math.min(...levels));
    }

    /**
     * Closes the open phrase after its first `length` frames, and feeds the frames after it in again. They can't close
     * another phrase: after a pause they are less than a pause long, and after a cut less than CUT_WINDOW. A phrase
     * that is too quiet to be speech was the room getting louder, so the floor learns from it.
     */
    private close(length: number): Float32Array | null {
        const { phrase, speech } = this;
        const kept = phrase.slice(0, length);
        // Stryker disable next-line EqualityOperator: levels are real numbers; none lands exactly on the threshold.
        const loud = kept.some(f => f.db >= this.floor() + PEAK_OVER_FLOOR_DB);
        if (!loud) for (const f of kept) this.hear(f);
        this.phrase = [];
        this.speech = 0;
        this.silentRun = 0;
        for (const frame of phrase.slice(length)) this.add(frame);
        return speech >= MIN_SPEECH && loud ? join(kept) : null;
    }
}
