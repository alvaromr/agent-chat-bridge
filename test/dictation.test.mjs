// Pure parts of the Dictation plugin: holding Space (plugins/dictation/space.ts) and the box's text
// (plugins/dictation/text.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { IDLE, spaceDown, spaceUp, TYPED } from "../plugins/dictation/space.ts";
import { compose, withoutTypedSpaces } from "../plugins/dictation/text.ts";

/** Runs keydowns (true for an auto-repeat) and returns each action's kind, and the last state. */
function hold(repeats, state = IDLE) {
    const kinds = [];
    for (const repeat of repeats) {
        const [next, action] = spaceDown(state, repeat);
        state = next;
        kinds.push(action.kind);
    }
    return { kinds, state };
}

test("space: as in Claude Code, two spaces are typed, the next two kept out, and the fifth press starts", () => {
    assert.equal(TYPED, 2);
    const { kinds, state } = hold([false, true, true, true, true, true]);
    assert.deepEqual(kinds, ["type", "warmup", "swallow", "swallow", "start", "swallow"]);
    assert.deepEqual(state, { presses: 5, dictating: true });
    assert.deepEqual(spaceUp(state), [IDLE, { kind: "stop" }]);
});

test("space: released before the fifth press, the spaces kept out are typed after all", () => {
    assert.deepEqual(spaceUp(hold([false]).state), [IDLE, { kind: "none" }]);
    assert.deepEqual(spaceUp(hold([false, true]).state), [IDLE, { kind: "abort", spaces: 0 }]);
    assert.deepEqual(spaceUp(hold([false, true, true, true]).state), [IDLE, { kind: "abort", spaces: 2 }]);
    assert.deepEqual(spaceUp(IDLE), [IDLE, { kind: "none" }]);
});

test("space: only the key's auto-repeat counts; a new press, or a repeat with no first press, starts over", () => {
    assert.deepEqual(hold([false, true, false]).kinds, ["type", "warmup", "type"]);
    assert.deepEqual(hold([true, true]).kinds, ["type", "warmup"]);
});

test("text: the spaces that holding Space typed come off the end of the draft, and only those", () => {
    assert.equal(withoutTypedSpaces("hola  ", 2), "hola");
    assert.equal(withoutTypedSpaces("hola   ", 2), "hola ");
    assert.equal(withoutTypedSpaces("hola ", 2), "hola");
    assert.equal(withoutTypedSpaces("hola", 2), "hola");
    assert.equal(withoutTypedSpaces("  ", 2), "");
    assert.equal(withoutTypedSpaces("hola  ", 0), "hola  ");
});

test("text: what was said goes after the draft, one space apart", () => {
    assert.equal(compose("", "Hola. ¿Qué tal?"), "Hola. ¿Qué tal?");
    assert.equal(compose("Mira:", "Hola."), "Mira: Hola.");
    assert.equal(compose("Mira: ", "Hola."), "Mira: Hola.");
    assert.equal(compose("Mira esto", "Hola."), "Mira esto Hola.");
    assert.equal(compose("Mira:\n", "Hola."), "Mira:\nHola.");
    assert.equal(compose("Mira:", ""), "Mira:");
    assert.equal(compose("", ""), "");
});
