// Rule 3 rate limit for send, edit, delete and react (mod/src/renderer/rateLimit.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { rateLimiter } from "../mod/src/renderer/rateLimit.ts";

const T = 1_000_000_000_000;
const WAIT = "Límite de ritmo: espera unos segundos entre acciones en el mismo chat";
const HOURLY = "Límite de ritmo: ya hay 30 envíos, ediciones, borrados o reacciones en la última hora";

test("5 s between actions in the same chat, none between different chats", () => {
    const limit = rateLimiter();
    assert.equal(limit.limited("1", T), null);
    limit.record("1", T);
    assert.equal(limit.limited("1", T + 4999), WAIT);
    assert.equal(limit.limited("2", T + 1), null);
    assert.equal(limit.limited("1", T + 5000), null);
});

test("30 actions per hour in total, from any chat", () => {
    const limit = rateLimiter();
    for (let i = 0; i < 30; i++) {
        assert.equal(limit.limited(String(i), T + i), null, `action ${i + 1}`);
        limit.record(String(i), T + i);
    }
    assert.equal(limit.limited("99", T + 30), HOURLY);
    // Each one stops counting once it is more than an hour old.
    assert.equal(limit.limited("99", T + 3_600_000), HOURLY);
    assert.equal(limit.limited("99", T + 3_600_001), null);
});

test("each limiter counts only its own actions", () => {
    const a = rateLimiter();
    a.record("1", T);
    assert.equal(rateLimiter().limited("1", T), null);
});
