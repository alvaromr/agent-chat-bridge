// Repeated `watch` events (mod/src/renderer/dedupe.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { firstTimeChecker } from "../mod/src/renderer/dedupe.ts";

test("each key is new the first time and a repeat after, per checker", () => {
    const firstTime = firstTimeChecker();
    assert.equal(firstTime("mensaje:1"), true);
    assert.equal(firstTime("mensaje:1"), false);
    assert.equal(firstTime("borrado:1"), true);
    assert.equal(firstTimeChecker()("mensaje:1"), true);
});

test("past 200 keys the memory starts over", () => {
    const firstTime = firstTimeChecker();
    for (let i = 0; i < 200; i++) firstTime(String(i));
    assert.equal(firstTime("0"), false, "the 200 keys are still remembered");
    assert.equal(firstTime("200"), true);
    assert.equal(firstTime("0"), true, "forgotten when the 201st arrived");
    assert.equal(firstTime("200"), false);
});
