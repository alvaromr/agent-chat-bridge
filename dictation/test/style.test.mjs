// How the dictated text is written (dictation/src/style.ts): the final period, sentence capitals and opening marks.
import assert from "node:assert/strict";

import { test } from "vitest";

import { restyle } from "../src/style.ts";

const NONE = { noFinalPeriod: false, noSentenceCapitals: false, noOpeningMarks: false };
const only = key => ({ ...NONE, [key]: true });

test("style: with every option off the text stays as Whisper wrote it", () => {
    assert.equal(restyle("¿Hola? Vale. Hecho.", NONE, []), "¿Hola? Vale. Hecho.");
});

test("style: only the period that ends the text goes, not the ones between sentences nor an ellipsis", () => {
    const style = only("noFinalPeriod");
    assert.equal(restyle("Hice el commit. Ahora el push.", style, []), "Hice el commit. Ahora el push");
    assert.equal(restyle("Ahora el push. ", style, []), "Ahora el push ");
    assert.equal(restyle("Y entonces...", style, []), "Y entonces...");
    assert.equal(restyle("¿Lo subo?", style, []), "¿Lo subo?");
    assert.equal(restyle("", style, []), "");
});

test("style: each sentence's capital goes lower case, past its opening marks and quotes", () => {
    const style = only("noSentenceCapitals");
    assert.equal(restyle("Hice el commit. Ahora el push! ¿Lo subo? «Vale»… Hecho", style, []),
        "hice el commit. ahora el push! ¿lo subo? «vale»… hecho");
    // Only at a sentence's start: a capital inside one, or after a comma, stays.
    assert.equal(restyle("Mira, Ana lo dijo.Bien", style, []), "mira, Ana lo dijo.Bien");
    assert.equal(restyle("Vale.\n\nSigo", style, []), "vale.\n\nsigo");
});

test("style: a sentence's capital stays for an acronym or a vocabulary word written that way", () => {
    const style = only("noSentenceCapitals");
    assert.equal(restyle("Claude lo hizo. Git también. API lista. Claudia no.", style, ["Claude Code", "git", "API"]),
        "Claude lo hizo. git también. API lista. claudia no.");
    // The whole word counts: «Claudes» is not «Claude».
    assert.equal(restyle("Claudes", style, ["Claude"]), "claudes");
    assert.equal(restyle("Ok2 sí", style, []), "Ok2 sí");
});

test("style: the opening ¿ and ¡ go, the closing ones stay", () => {
    assert.equal(restyle("¿Qué tal? ¡Genial!", only("noOpeningMarks"), []), "Qué tal? Genial!");
});

test("style: all together", () => {
    const all = { noFinalPeriod: true, noSentenceCapitals: true, noOpeningMarks: true };
    assert.equal(restyle("¿Hago el commit? Sí. Claude lo revisa.", all, ["Claude"]), "hago el commit? sí. Claude lo revisa");
});
