// How the dictated text is written, apart from what was said: the final period, the capital that opens each sentence,
// and the opening ¿ and ¡ of Spanish. Pure.

export interface Style {
    /** Drops the period that ends the text; the ones between its sentences stay. */
    noFinalPeriod: boolean;
    /** Puts in lower case the capital that opens each sentence, unless the word is in the vocabulary that way. */
    noSentenceCapitals: boolean;
    /** Drops the opening ¿ and ¡; the closing ? and ! stay. */
    noOpeningMarks: boolean;
}

// A sentence's first word: at the start or after its end, past any opening marks and quotes. Only a capitalised word
// (an upper case letter, then lower case ones), so an acronym such as API keeps its capitals.
const SENTENCE_START = /(^|[.!?…]\s+)([¿¡"'«(]*)(\p{Lu})(\p{Ll}*)(?![\p{L}\p{N}])/gu;

/** The text in the given style; `words` is the vocabulary, as the user writes it. */
export function restyle(text: string, style: Style, words: string[]): string {
    let out = text;
    if (style.noOpeningMarks) out = out.replace(/[¿¡]/g, "");
    if (style.noSentenceCapitals) {
        const kept = new Set(words.map(w => w.split(" ")[0]));
        out = out.replace(SENTENCE_START, (all, end: string, marks: string, capital: string, rest: string) =>
            kept.has(capital + rest) ? all : end + marks + capital.toLowerCase() + rest);
    }
    // A lone period: an ellipsis stays.
    if (style.noFinalPeriod) out = out.replace(/(?<!\.)\.(\s*)$/, "$1");
    return out;
}
