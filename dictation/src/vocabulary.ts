// The user's words: the prompt that biases Whisper towards them, the check that it didn't answer with that prompt,
// and the replacements for what it still gets wrong. Pure.

/** Words separated by commas or new lines, trimmed, without blanks or repeats. */
export function parseWords(text: string): string[] {
    return [...new Set(text.split(/[,\n]/).map(w => w.trim()).filter(Boolean))];
}

/**
 * A sentence that names the words, which Whisper takes as the text before the audio. A bare list made it answer
 * with the list instead of the audio; a sentence did not (measured on the user's recordings).
 */
export function promptFor(words: string[]): string | null {
    if (!words.length) return null;
    const head = words.slice(0, -1);
    return `Hablamos de ${head.length ? `${head.join(", ")} y ` : ""}${words.at(-1)}.`;
}

// Stryker disable next-line MethodExpression: upper case would compare the same as lower case.
const normalize = (text: string) => [...text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map(m => m[0]);

/** Consecutive words of the answer that also appear consecutively in the prompt, from which it is the prompt. */
const ECHO_RUN = 4;

/** Whether the answer repeats a run of the prompt instead of transcribing the audio. */
export function isEcho(answer: string, prompt: string | null): boolean {
    if (!prompt) return false;
    const said = normalize(answer), asked = normalize(prompt).join(" ");
    for (let i = 0; i + ECHO_RUN <= said.length; i++) {
        if (` ${asked} `.includes(` ${said.slice(i, i + ECHO_RUN).join(" ")} `)) return true;
    }
    return false;
}

export type Replacement = readonly [from: string, to: string];

/** One `heard => meant` per line. Returns the pairs and the numbers (from 1) of the lines that aren't one. */
export function parseReplacements(text: string): { pairs: Replacement[]; invalid: number[]; } {
    const pairs: Replacement[] = [], invalid: number[] = [];
    for (const [i, line] of text.split("\n").entries()) {
        if (!line.trim()) continue;
        const [from, to, ...rest] = line.split("=>").map(s => s.trim());
        if (from && to != null && !rest.length) pairs.push([from, to]);
        else invalid.push(i + 1);
    }
    return { pairs, invalid };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Applies each replacement to whole words, ignoring case. */
export function applyReplacements(text: string, pairs: Replacement[]): string {
    return pairs.reduce(
        (out, [from, to]) => out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(from)}(?![\\p{L}\\p{N}])`, "giu"), to),
        text
    );
}
