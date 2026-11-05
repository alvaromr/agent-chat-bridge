// The CLI's socket side (main() of scripts/acb.mjs) on a faked socket: what it sends Discord, how it prints the answer
// or each event of a `watch`, and its exit codes. Run with `pnpm test`.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";

import { beforeEach, test, vi } from "vitest";

/** Each connection: the path, what was written, and the fake socket. @type {any[]} */
const conns = vi.hoisted(() => []);
vi.mock("net", () => ({
    connect: (path, onConnect) => {
        const conn = Object.assign(new EventEmitter(), { path, written: "", setEncoding: () => { }, write: text => void (conn.written += text) });
        conns.push(conn);
        queueMicrotask(onConnect);
        return conn;
    }
}));

const { main } = await import("../scripts/acb.mjs");

let out, err, exit;
beforeEach(() => {
    conns.length = 0;
    out = vi.spyOn(console, "log").mockImplementation(() => { });
    err = vi.spyOn(console, "error").mockImplementation(() => { });
    exit = vi.spyOn(process, "exit").mockImplementation(/** @type {any} */ (() => { }));
});
const printed = spy => spy.mock.calls.map(args => args.join(" "));

test("cli: a request goes to the app's socket as one JSON line, and its answer is printed; a failed one exits with 1", async () => {
    main(["list"]);
    const [conn] = conns;
    assert.equal(conn.path, join(homedir(), "Library/Application Support/agent-chat-bridge/compose.sock"));
    await vi.waitFor(() => assert.equal(conn.written, JSON.stringify({ list: true }) + "\n"));
    conn.emit("data", '{"ok":true,');
    conn.emit("data", '"chats":[]}\n');
    conn.emit("end");
    assert.deepEqual(printed(out), [JSON.stringify({ ok: true, chats: [] }, null, 2)]);
    assert.deepEqual(exit.mock.calls, [[0]]);
    main(["list"]);
    conns[1].emit("data", '{"ok":false,"error":"x"}\n');
    conns[1].emit("end");
    assert.deepEqual(exit.mock.calls[1], [1]);
});

test("cli: a watch prints each event as its line arrives, and ends when Discord closes it", () => {
    main(["watch", "123456789012345678"]);
    const [conn] = conns;
    conn.emit("data", '\n{"ok":true}\n{"evento":');
    assert.deepEqual(printed(out), ["", '{"ok":true}'], "an empty line is a line too, and what follows it still comes");
    conn.emit("data", '"mensaje"}\n');
    assert.deepEqual(printed(out), ["", '{"ok":true}', '{"evento":"mensaje"}']);
    conn.emit("end");
    assert.deepEqual(exit.mock.calls, [[0]]);
});

test("cli: without Discord's socket it says so; another failure, by its message; both exit with 1", () => {
    for (const code of ["ENOENT", "ECONNREFUSED"]) {
        main(["list"]);
        conns.at(-1).emit("error", Object.assign(new Error("x"), { code }));
    }
    main(["list"]);
    conns.at(-1).emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" }));
    assert.deepEqual(printed(err), ["Discord no está abierto con el parche (falta el socket)", "Discord no está abierto con el parche (falta el socket)", "permission denied"]);
    assert.deepEqual(exit.mock.calls, [[1], [1], [1]]);
});

test("cli: run as a command, it reads its arguments after node and the script", () => {
    const argv = process.argv;
    process.argv = ["node", "/usr/local/bin/acb", "list", "--help"];
    try {
        main();
    } finally {
        process.argv = argv;
    }
    assert.match(printed(out)[0] ?? "", /^acb list/);
    assert.deepEqual(exit.mock.calls, [[0]]);
});

test("cli: a wrong command line exits with 2 and its usage; --help prints the help and connects nowhere", () => {
    main(["nada"]);
    assert.equal(exit.mock.calls[0]?.[0], 2);
    assert.equal(printed(err).length, 1);
    main(["list", "--help"]);
    assert.match(printed(out)[0] ?? "", /^acb list/);
    assert.deepEqual(exit.mock.calls[1], [0]);
    assert.equal(conns.length, 0);
});
