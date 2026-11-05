// The user's words (dictation/src/vocabulary.ts): the prompt, the echo check and the replacements.
import assert from "node:assert/strict";

import { test } from "vitest";

import { applyReplacements, isEcho, parseReplacements, parseWords, promptFor } from "../src/vocabulary.ts";

test("vocabulary: words split on commas and new lines, trimmed, without blanks or repeats", () => {
    assert.deepEqual(parseWords(" git, pull request\nClaude Code,, \n git "), ["git", "pull request", "Claude Code"]);
    assert.deepEqual(parseWords(""), []);
});

test("vocabulary: the prompt is a sentence that names every word", () => {
    assert.equal(promptFor(["git", "commit", "Claude Code"]), "Hablamos de git, commit y Claude Code.");
    assert.equal(promptFor(["git"]), "Hablamos de git.");
    assert.equal(promptFor([]), null);
});

test("vocabulary: an answer with 4 words in a row from the prompt is the prompt said back", () => {
    const prompt = "Hablamos de git, commit, push y Claude Code.";
    assert.equal(isEcho("Commit, push y Claude.", prompt), true);
    assert.equal(isEcho("hablamos de git commit", prompt), true);
    assert.equal(isEcho("Oye, commit, push y Claude, ¿vale?", prompt), true);
    // Three in a row, or four out of order, is speech that uses the words.
    assert.equal(isEcho("Hice commit, push y luego Claude.", prompt), false);
    assert.equal(isEcho("push commit git de", prompt), false);
    // Whole words only: «push y claude code» is in the prompt, «ush y claude cod» is not.
    assert.equal(isEcho("ush y Claude Cod", prompt), false);
    assert.equal(isEcho("Hablamos de git, commit", null), false);
    assert.equal(isEcho("¡¿…?!", prompt), false);
});

test("vocabulary: replacements are «heard => meant» lines; the others are reported by number", () => {
    assert.deepEqual(parseReplacements("Griscord => Discord\n\n  Worldtree=>worktree  \n   \nsin flecha\na => b => c\n => x\ny =>"), {
        pairs: [["Griscord", "Discord"], ["Worldtree", "worktree"], ["y", ""]],
        invalid: [5, 6, 7]
    });
});

test("vocabulary: a replacement changes whole words, in any case, everywhere", () => {
    /** @type {[string, string][]} */
    const pairs = [["griscord", "Discord"], ["c++", "C++"], ["de input", "y un push"]];
    assert.equal(applyReplacements("Abre Griscord y GRISCORD, no Griscordia ni subgriscord.", pairs), "Abre Discord y Discord, no Griscordia ni subgriscord.");
    assert.equal(applyReplacements("Hablo de c++ y de input.", pairs), "Hablo de C++ y y un push.");
    assert.equal(applyReplacements("nada", []), "nada");
});
