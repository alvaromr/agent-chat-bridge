// Pure parts of the plugins: the Corrector's case fix and rewrite check (plugins/corrector/text.ts) and the transcript
// that the Autorespuesta gives Claude (plugins/autorespuesta/transcript.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { buildTranscript } from "../plugins/autorespuesta/transcript.ts";
import { keepOriginalCase, rewritten } from "../plugins/corrector/text.ts";

test("corrector: keeps the original letter case and takes the accent fixes", () => {
    assert.equal(keepOriginalCase("el Dia que vino", "El Día que vino"), "el Día que vino");
    assert.equal(keepOriginalCase("HOLA ke tal", "hola qué tal"), "HOLA qué tal");
    assert.equal(keepOriginalCase("vale", "Vale"), "vale");
});

test("corrector: joins split words and keeps the model's spacing", () => {
    assert.equal(keepOriginalCase("Qu e Tal", "Que tal"), "Que Tal");
    assert.equal(keepOriginalCase("a  b", "a  b"), "a  b");
    assert.equal(keepOriginalCase("hola\nadiós", "Hola\nAdiós"), "hola\nadiós");
});

test("corrector: when the letters don't pair one to one, the word stays as the user wrote it", () => {
    // "n" + a combining diaeresis has no precomposed form: it folds to "n" but is two characters long.
    assert.equal(keepOriginalCase("n̈o", "No"), "n̈o");
});

test("corrector: a word the model replaces entirely stays as the model wrote it", () => {
    assert.equal(keepOriginalCase("vamos mañana", "Iremos mañana"), "Iremos mañana");
});

test("corrector: words the model adds or drops don't shift the case onto another word", () => {
    assert.equal(keepOriginalCase("Ya voy", "voy ya voy"), "voy Ya voy");
    assert.equal(keepOriginalCase("Ya", "voy voy ya"), "voy voy Ya");
    assert.equal(keepOriginalCase("Ya Ya voy", "ya no ya"), "Ya no Ya");
    assert.equal(keepOriginalCase("Ya voy no", "no ya"), "no ya");
    assert.equal(keepOriginalCase("Hola Ana y Luis", "hola y ana y luis"), "Hola y Ana y Luis");
    assert.equal(keepOriginalCase("hola", "Hola amigo"), "hola amigo");
    assert.equal(keepOriginalCase("hola amigo", "Hola"), "hola");
});

test("corrector: between two alignments of the same length, the model's earlier word keeps its case", () => {
    assert.equal(keepOriginalCase("Ya no", "No ya"), "no ya");
});

test("corrector: moving spaces, accents and one-letter mistakes are not a rewrite", () => {
    const prisas = "si a alguien le entran las prisas y averemos";
    assert.equal(rewritten(prisas, "si a alguien le entran las prisas ya veremos"), false);
    assert.equal(rewritten("nolo se", "no lo sé"), false);
    assert.equal(rewritten("qe tal estas", "qué tal estás"), false);
    assert.equal(rewritten("vamos haber si", "vamos a ver si"), false);
});

test("corrector: replacing words with others is a rewrite", () => {
    assert.equal(rewritten("si a alguien le entran las prisas y averemos", "si a alguien le entran las prisas y se equivoca"), true);
    assert.equal(rewritten("vale", "de acuerdo"), true);
    assert.equal(rewritten("vale", "voy"), true);
});

test("corrector: removing a piece is a rewrite; removing one extra letter is not", () => {
    assert.equal(rewritten("te lo di je ayer", "te lo di ayer"), true);
    assert.equal(rewritten("no lo voy a hechar", "no lo voy a echar"), false);
});

const nacho = { id: "1", username: "nacho", globalName: "Nacho" };
const me = { id: "2", username: "ana", globalName: null };
/** @param {typeof nacho | typeof me} author @param {string} content @param {unknown[]} [attachments] */
const msg = (author, content, attachments = []) => ({ author, content, attachments });

test("autorespuesta: one line per message, mine marked, ending with an empty one of mine", () => {
    assert.equal(
        buildTranscript([msg(nacho, "¿vienes?"), msg(me, "igual"), msg(nacho, "", [{}]), msg(nacho, "")], me),
        "Nacho: ¿vienes?\n(yo) ana: igual\nNacho:  [adjunto]\n(yo) ana:"
    );
});
