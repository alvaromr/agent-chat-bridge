// The network block of test/setup.mjs. Run with `pnpm test`.
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { connect } from "node:net";

import { test } from "vitest";

const refused = { message: "The unit tests run without network" };

test("a TCP or local socket connection is refused before it leaves", () => {
    assert.throws(() => connect(9, "127.0.0.1"), refused);
    assert.throws(() => connect("/tmp/agent-chat-bridge-test.sock"), refused);
});

test("fetch is refused before it leaves", async () => {
    await assert.rejects(fetch("http://127.0.0.1:8080/"), err => err instanceof Error && err.cause instanceof Error
        && err.cause.message === refused.message);
});

test("a UDP datagram is refused before it leaves", () => {
    const socket = createSocket("udp4");
    assert.throws(() => socket.send("x", 9, "127.0.0.1"), refused);
    socket.close();
});
