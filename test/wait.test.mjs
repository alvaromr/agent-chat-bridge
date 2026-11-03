// The wait for Discord's stores (mod/src/plugin-api/wait.ts), on a fake clock. Run with `pnpm test`.
import assert from "node:assert/strict";

import { afterEach, beforeEach, test, vi } from "vitest";

import { waitFor } from "../mod/src/plugin-api/wait.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Starts the wait and says, as fake time passes, whether it has resolved. */
function track(condition, timeoutMs) {
    const state = { done: false };
    waitFor(condition, timeoutMs).then(() => state.done = true);
    return state;
}

test("waitFor resolves at once when the condition already holds", async () => {
    const wait = track(() => true, 1000);
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(wait.done, true);
});

test("waitFor resolves on the first check, every 50 ms, after the condition holds", async () => {
    let ready = false;
    setTimeout(() => ready = true, 120);
    const wait = track(() => ready, 1000);
    await vi.advanceTimersByTimeAsync(149);
    assert.equal(wait.done, false);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(wait.done, true);
});

test("waitFor gives up at the timeout when the condition never holds", async () => {
    const wait = track(() => false, 1000);
    await vi.advanceTimersByTimeAsync(999);
    assert.equal(wait.done, false);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(wait.done, true);
});
