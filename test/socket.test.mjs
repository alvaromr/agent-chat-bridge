// Regression tests of the CLI's socket (mod/src/compose.ts) on a fake Electron and a fake server: no socket is opened.
// Run with `pnpm test`.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, test, vi } from "vitest";

/** What the fake Electron returns, and the connection handler the server got. @type {{ appData: string, windows: any[], onConnection: any }} */
const fake = vi.hoisted(() => ({ appData: "", windows: [], onConnection: null }));
vi.mock("electron", () => ({
    app: { getPath: () => fake.appData, on: () => { }, focus: () => { } },
    BrowserWindow: { getAllWindows: () => fake.windows },
    ipcMain: { on: () => { } }
}));
vi.mock("net", () => ({
    Socket: class { },
    createServer: onConnection => {
        fake.onConnection = onConnection;
        return { listen: () => { }, close: () => { } };
    }
}));

fake.appData = mkdtempSync(join(tmpdir(), "agent-chat-bridge-socket-"));
afterAll(() => rmSync(fake.appData, { recursive: true, force: true }));
const { startComposeServer } = await import("../mod/src/compose.ts");
startComposeServer();

/** A CLI connection to the fake server: what it is sent, and the answer it gets. */
function connect() {
    const conn = Object.assign(new EventEmitter(), { setEncoding: () => { }, destroy: vi.fn(), write: vi.fn(), end: vi.fn() });
    fake.onConnection(conn);
    return conn;
}
const answer = async conn => {
    await vi.waitFor(() => assert.equal(conn.end.mock.calls.length, 1));
    return JSON.parse(conn.end.mock.calls[0][0]);
};

beforeEach(() => {
    fake.windows = [];
});
afterEach(() => vi.useRealTimers());

test("the CLI hanging up is normal; any other connection error is logged by its code", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    const conn = connect();
    conn.emit("error", Object.assign(new Error("hung up"), { code: "EPIPE" }));
    conn.emit("error", Object.assign(new Error("reset"), { code: "ECONNRESET" }));
    assert.equal(error.mock.calls.length, 0);
    conn.emit("error", Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
    conn.emit("error", new Error("no code"));
    assert.deepEqual(error.mock.calls, [
        ["[agent-chat-bridge] CLI connection failed: ETIMEDOUT"], ["[agent-chat-bridge] CLI connection failed: no code"]
    ]);
});

test("a request that fails inside Discord still gets an answer, so the CLI never waits forever", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    fake.windows = [{
        webContents: {
            getURL: () => "https://discord.com/channels/@me",
            send: () => {
                throw new Error("the renderer is gone");
            }
        }
    }];
    const conn = connect();
    conn.emit("data", JSON.stringify({ list: true }) + "\n");
    assert.deepEqual(await answer(conn), { ok: false, error: "Discord no pudo atender la petición" });
    assert.deepEqual(error.mock.calls, [["[agent-chat-bridge] CLI request failed: the renderer is gone"]]);
});

test("without Discord's main window the request is refused, saying why", async () => {
    const conn = connect();
    conn.emit("data", JSON.stringify({ list: true }) + "\n");
    assert.deepEqual(await answer(conn), { ok: false, error: "Discord no tiene la ventana principal abierta" });
});
