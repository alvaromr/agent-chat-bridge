// With its extension, so Node loads it in test/ as the bundlers do.
import { elementAt } from "../shared/list.ts";

// Stryker disable next-line MethodExpression: both sides of every comparison fold alike; upper and lower case only part ways on letters like ß, which Spanish doesn't use.
const fold = (word: string) => word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Copies the original letter case onto a word the model only re-accented ("Dia" → "Día", never "dia" → "Día"). */
function withOriginalCase(original: string, fixed: string) {
    const o = [...original.normalize("NFC")], f = [...fixed.normalize("NFC")];
    if (o.length !== f.length) return original;
    return f.map((c, i) => elementAt(o, i) === elementAt(o, i).toUpperCase() ? c.toUpperCase() : c.toLowerCase()).join("");
}

/** Undoes case changes the model makes despite the prompt, keeping its accent fixes. */
export function keepOriginalCase(original: string, fixed: string) {
    // Stryker disable next-line MethodExpression,Regex: an empty word can only pair with an empty edge of `parts`, which stays empty.
    const a = original.split(/\s+/).filter(Boolean).map(w => ({ w, f: fold(w) }));
    // Stryker disable next-line Regex: splitting each space apart only adds empty words, which pair with nothing.
    const parts = fixed.split(/(\s+)/); // words at even indexes, whitespace at odd ones
    const b = parts.flatMap((w, k) => k % 2 ? [] : [{ k, f: fold(w) }]);

    // Longest common subsequence of folded words, so inserted or merged words ("qu e" → "que") don't shift the match.
    const lcs: number[][] = [];
    const common = (i: number, j: number) => lcs[i]?.[j] ?? 0; // past the last word of either: nothing in common
    for (const [i, word] of [...a.entries()].reverse()) {
        const row: number[] = lcs[i] = [];
        for (const [j, other] of [...b.entries()].reverse())
            row[j] = word.f === other.f ? common(i + 1, j + 1) + 1 : Math.max(common(i + 1, j), common(i, j + 1));
    }

    for (let i = 0, j = 0; i < a.length && j < b.length;) {
        const word = elementAt(a, i), other = elementAt(b, j);
        if (word.f === other.f) {
            parts[other.k] = withOriginalCase(word.w, elementAt(parts, other.k));
            i++;
            j++;
        }
        else if (common(i + 1, j) >= common(i, j + 1)) i++;
        else j++;
    }
    return parts.join("");
}

/** Letters changed, added or removed (Levenshtein distance) between two strings. */
function editDistance(a: string[], b: string[]) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (const [i, ca] of a.entries()) {
        const row = [i + 1];
        for (const [j, cb] of b.entries())
            row.push(Math.min(elementAt(prev, j + 1) + 1, elementAt(row, j) + 1, elementAt(prev, j) + (ca === cb ? 0 : 1)));
        prev = row;
    }
    return elementAt(prev, b.length);
}

/**
 * Whether the model rewrote the message instead of fixing it. Spaces, accents and case don't count, so moving
 * spaces ("y averemos" → "ya veremos") is free; a spelling fix changes a letter or two per mistake, and removes one
 * at most ("hechar" → "echar"), never a piece it didn't understand ("di je" → "di").
 */
export function rewritten(original: string, fixed: string) {
    const letters = (s: string) => [...fold(s).replace(/\s/g, "")];
    const a = letters(original), b = letters(fixed);
    return a.length - b.length >= 2 || editDistance(a, b) > Math.max(2, Math.round(a.length * 0.1));
}
