// Regexes for patches and CSS classes (mod/src/renderer/regex.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { canonicalize, classNameRegex } from "../mod/src/renderer/regex.ts";

test("\\i stands for any JavaScript identifier", () => {
    const re = canonicalize(/^\i\.send\(\i\)$/);
    for (const code of ["e.send(t)", "$a.send(_b1)", "Ab$.send(x)"]) assert.match(code, re);
    for (const code of ["1e.send(t)", "e.send()", "a-b.send(t)"]) assert.doesNotMatch(code, re);
});

test("an escaped \\i is left alone, and the flags are kept", () => {
    assert.equal(canonicalize(/a\\i/).source, String.raw`a\i`);
    assert.equal(canonicalize(/\\\i/).source, String.raw`\\(?:[A-Za-z_$][\w$]*)`);
    assert.equal(canonicalize(/\i/gs).flags, "gs");
});

test("CSS classes: the readable name with or without its suffix, as a whole word", () => {
    const re = classNameRegex("button");
    for (const list of ["button", "button_a1b2", "other_x button_a1b2 more"]) assert.match(list, re);
    for (const list of ["buttonInner_a1b2", "my-button_a1", "xbutton"]) assert.doesNotMatch(list, re);
});
