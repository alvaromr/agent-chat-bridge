// One dictation: audio in, the open phrase's text (partial) and each closed phrase's text (final) out. Pure: the
// transcriber is given, so the worker process or a fake both fit.
// With their extensions, so plain Node runs these files too, as outside this repo it would.
import { SAMPLE_RATE, Segmenter } from "./segmenter.ts";
import { applyReplacements, isEcho, type Replacement } from "./vocabulary.ts";

export interface Transcriber {
    /** The text Whisper hears in the samples, with the prompt as the text before them. */
    transcribe(samples: Float32Array, prompt: string | null): Promise<string>;
}

export interface DictationOptions {
    /** Built by promptFor() from the user's words. */
    prompt: string | null;
    replacements: Replacement[];
    /** The open phrase's text so far; each call replaces the previous one. */
    onPartial(text: string): void;
    /** A closed phrase's text; the next partial belongs to the next phrase. */
    onFinal(text: string): void;
    /** The transcriber failed: the dictation ends here, and stop() resolves without the rest. */
    onError(err: unknown): void;
}

/** New audio in the open phrase that asks for a new partial: half a second. */
const PARTIAL_EVERY = SAMPLE_RATE / 2;

export class Dictation {
    private readonly segmenter = new Segmenter();
    /** Closed phrases waiting for their final text, in order. */
    private readonly finals: Float32Array[] = [];
    /** Length of the open phrase at its last partial. */
    private partialAt = 0;
    private busy = false;
    private ended = false;
    private idle: (() => void) | null = null;

    constructor(private readonly transcriber: Transcriber, private readonly options: DictationOptions) {}

    push(samples: Float32Array) {
        if (this.ended) return;
        for (const phrase of this.segmenter.push(samples)) {
            this.finals.push(phrase);
            this.partialAt = 0;
        }
        this.next();
    }

    /** Ends the audio; resolves once every final text is out. */
    stop(): Promise<void> {
        if (!this.ended) {
            this.ended = true;
            const last = this.segmenter.flush();
            if (last) this.finals.push(last);
        }
        return new Promise(resolve => {
            this.idle = resolve;
            this.next();
        });
    }

    /** Ends the audio and drops the phrases not transcribed yet; the one in progress still finishes and is emitted. */
    cancel() {
        this.ended = true;
        this.finals.length = 0;
    }

    /**
     * Starts the next transcription: a closed phrase first, else a partial of the open one. A final that is only the
     * prompt said back is transcribed again without it; such a partial is skipped.
     */
    private next() {
        if (this.busy) return;
        const { prompt, onFinal, onPartial } = this.options;
        const final = this.finals.shift();
        if (final) return this.run(this.heard(final, prompt).then(text => text ?? this.heard(final, null)), onFinal);

        const open = this.ended ? null : this.segmenter.current();
        // Stryker disable next-line EqualityOperator: both lengths are whole frames, never exactly PARTIAL_EVERY apart.
        if (open && open.length - this.partialAt >= PARTIAL_EVERY) {
            this.partialAt = open.length;
            return this.run(this.heard(open, prompt), onPartial);
        }
        // Set only by stop(), so only once the audio has ended.
        this.idle?.();
    }

    private run(work: Promise<string | null>, emit: (text: string) => void) {
        this.busy = true;
        work.then(text => {
            // Empty when Whisper heard no words; null when it only said the prompt back.
            if (text) emit(text);
        }, err => {
            this.ended = true;
            this.finals.length = 0;
            this.options.onError(err);
        }).finally(() => {
            this.busy = false;
            this.next();
        });
    }

    /** What Whisper heard, with the replacements, or null when it only said the prompt back. */
    private async heard(samples: Float32Array, prompt: string | null) {
        const text = await this.transcriber.transcribe(samples, prompt);
        return isEcho(text, prompt) ? null : applyReplacements(text, this.options.replacements);
    }
}
