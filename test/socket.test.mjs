// The CLI's socket (mod/src/compose.ts) on a fake Electron and a fake server, in a temporary folder: no socket is
// opened. Who may connect, what a request must be, how it reaches the renderer and comes back, and the `watch`
// connections. Run with `pnpm test`.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, test, vi } from "vitest";

/** What the fake Electron returns, and what it was given. @type {any} */
const fake = vi.hoisted(() => ({ appData: "", windows: [], onConnection: null, ipc: new Map(), quit: null, focus: [], server: { closed: 0 } }));
vi.mock("electron", () => ({
    app: {
        getPath: () => fake.appData,
        on: (event, listener) => void (event === "will-quit" && (fake.quit = listener)),
        focus: options => void fake.focus.push(options)
    },
    BrowserWindow: { getAllWindows: () => fake.windows },
    ipcMain: { on: (channel, listener) => void fake.ipc.set(channel, listener) }
}));
vi.mock("net", () => ({
    Socket: class { },
    createServer: onConnection => {
        fake.onConnection = onConnection;
        return {
            // The socket file appears, as listening creates it.
            listen: (path, ready) => {
                writeFileSync(path, "");
                ready();
            },
            close: () => void fake.server.closed++
        };
    }
}));

fake.appData = mkdtempSync(join(tmpdir(), "agent-chat-bridge-socket-"));
afterAll(() => rmSync(fake.appData, { recursive: true, force: true }));
const FOLDER = join(fake.appData, "agent-chat-bridge"), SOCKET = join(FOLDER, "compose.sock");

const { IPC } = await import("../mod/src/ipc.ts");
const { startComposeServer } = await import("../mod/src/compose.ts");

test("socket: in a folder only the user can enter, replacing a stale one, readable only by the user; removed on quit", () => {
    startComposeServer();
    assert.equal(statSync(FOLDER).mode & 0o777, 0o700);
    assert.equal(statSync(SOCKET).mode & 0o777, 0o600);
    writeFileSync(SOCKET, "viejo");
    startComposeServer();
    assert.equal(statSync(SOCKET).size, 0, "the stale socket went first");
    fake.quit();
    assert.equal(fake.server.closed, 1);
    assert.throws(() => statSync(SOCKET), { code: "ENOENT" });
});

/** Discord's main window as Electron lists it: its page, and what the main process sends it. */
function mainWindow(url = "https://discord.com/channels/@me") {
    /** @type {any} */
    const window = {
        sent: [],
        minimized: false, shown: 0, restored: 0,
        isMinimized: () => window.minimized,
        restore: () => void window.restored++,
        show: () => void window.shown++
    };
    window.webContents = { getURL: () => url, send: (...args) => void window.sent.push(args) };
    return window;
}

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
/** The renderer answers every request it gets with `result`. */
function renderer(window, result) {
    window.webContents.send = (channel, id, req) => {
        window.sent.push([channel, id, req]);
        if (channel === IPC.composeRequest) queueMicrotask(() => fake.ipc.get(IPC.composeResponse)({}, id, typeof result === "function" ? result(req) : result));
    };
}
const ask = (conn, req) => conn.emit("data", JSON.stringify(req) + "\n");

beforeEach(() => {
    vi.useRealTimers();
    fake.windows = [];
    fake.focus = [];
    startComposeServer();
});

test("socket: a request reaches the main window's renderer and its answer goes back", async () => {
    const popout = mainWindow("https://discord.com/popout/1"), other = mainWindow("file:///splash.html"), main = mainWindow();
    fake.windows = [popout, other, main];
    renderer(main, { ok: true, chats: [] });
    const conn = connect();
    conn.emit("data", '{"list":');
    conn.emit("data", "true}\nresto");
    assert.deepEqual(await answer(conn), { ok: true, chats: [] });
    assert.equal(main.sent[0][0], IPC.composeRequest);
    assert.deepEqual(main.sent[0][2], { list: true });
    assert.equal(popout.sent.length + other.sent.length, 0);
    assert.equal(fake.focus.length, 0, "listing stays in the background");
});

test("socket: an answered request leaves no timer behind, and the answer is one line", async () => {
    vi.useFakeTimers();
    const main = mainWindow();
    fake.windows = [main];
    renderer(main, { ok: true, chats: [] });
    const conn = connect();
    ask(conn, { list: true });
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(conn.end.mock.calls[0]?.[0], '{"ok":true,"chats":[]}\n');
    assert.equal(vi.getTimerCount(), 0);
});

test("socket: a request of up to 16 KiB is read whole; one byte more cuts it off", () => {
    const conn = connect();
    conn.emit("data", "x".repeat(16 * 1024));
    assert.equal(conn.destroy.mock.calls.length, 0);
    conn.emit("data", "x");
    assert.equal(conn.destroy.mock.calls.length, 1);
});

test("socket: quitting with the socket already gone is fine", () => {
    rmSync(SOCKET, { force: true });
    assert.doesNotThrow(() => fake.quit());
});

test("socket: each request gets its own id, so answers can't cross", async () => {
    const main = mainWindow();
    fake.windows = [main];
    renderer(main, req => ({ ok: true, chats: [{ id: req.kinds[0] }] }));
    const [a, b] = [connect(), connect()];
    ask(a, { list: true, kinds: ["dm"] });
    ask(b, { list: true, kinds: ["canal"] });
    assert.deepEqual((await answer(a)).chats, [{ id: "dm" }]);
    assert.deepEqual((await answer(b)).chats, [{ id: "canal" }]);
    assert.notEqual(main.sent[0][1], main.sent[1][1]);
});

test("socket: what isn't JSON, or isn't a valid request, is refused before Discord sees it", async () => {
    const main = mainWindow();
    fake.windows = [main];
    for (const line of ["no es json", '{"send":"1","expect":"x","replyTo":"2"}', "[]"]) {
        const conn = connect();
        conn.emit("data", line + "\n");
        assert.deepEqual(await answer(conn), { ok: false, error: "Petición no válida" }, line);
    }
    assert.equal(main.sent.length, 0);
});

test("socket: without Discord's main window the request is refused, saying why", async () => {
    fake.windows = [mainWindow("https://discord.com/popout/2")];
    const conn = connect();
    ask(conn, { list: true });
    assert.deepEqual(await answer(conn), { ok: false, error: "Discord no tiene la ventana principal abierta" });
});

test("socket: a request too long is cut off, and nothing is answered before a whole line", () => {
    const conn = connect();
    conn.emit("data", "x".repeat(1000));
    assert.equal(conn.end.mock.calls.length + conn.destroy.mock.calls.length, 0);
    conn.emit("data", "x".repeat(16 * 1024));
    assert.equal(conn.destroy.mock.calls.length, 1);
});

test("socket: the files to attach are read here and go to the renderer as data; one that can't be read is refused", async () => {
    const main = mainWindow();
    fake.windows = [main];
    renderer(main, { ok: true, chat: { id: "1" }, abierto: true, borradorCargado: true });
    const file = join(fake.appData, "nota.txt");
    writeFileSync(file, "hola");
    const conn = connect();
    ask(conn, { channelId: "123456789012345678", text: "x", attach: [file] });
    await answer(conn);
    const [, , req] = main.sent[0];
    assert.equal(req.attach, undefined);
    assert.deepEqual(req.files.map(f => [f.name, f.type, Buffer.from(f.data).toString()]), [["nota.txt", "text/plain", "hola"]]);
    const missing = connect();
    ask(missing, { channelId: "123456789012345678", text: "x", attach: [join(fake.appData, "no.txt")] });
    assert.deepEqual(await answer(missing), { ok: false, error: `No existe: ${join(fake.appData, "no.txt")}` });
});

test("socket: a renderer that doesn't answer in 10 s gets the request reported as unanswered", async () => {
    vi.useFakeTimers();
    const main = mainWindow();
    fake.windows = [main];
    const conn = connect();
    ask(conn, { list: true });
    await vi.advanceTimersByTimeAsync(9_999);
    assert.equal(conn.end.mock.calls.length, 0);
    await vi.advanceTimersByTimeAsync(1);
    assert.deepEqual(JSON.parse(conn.end.mock.calls[0]?.[0]), { ok: false, error: "Discord no respondió" });
    fake.ipc.get(IPC.composeResponse)({}, main.sent[0][1], { ok: true, chats: [] });
    assert.equal(conn.end.mock.calls.length, 1, "a late answer goes nowhere");
});

test("socket: a loaded draft brings Discord to the front, restoring it if minimized; a dry run or background draft doesn't", async () => {
    const main = mainWindow();
    main.minimized = true;
    fake.windows = [main];
    const draft = { ok: true, chat: { id: "1" }, abierto: true, borradorCargado: true };
    renderer(main, draft);
    const req = { channelId: "123456789012345678", text: "x" };
    const conns = [{}, { dryRun: true }, { background: true }].map(extra => {
        const conn = connect();
        ask(conn, { ...req, ...extra });
        return conn;
    });
    for (const conn of conns) await answer(conn);
    assert.deepEqual([main.restored, main.shown, fake.focus], [1, 1, [{ steal: true }]]);
    main.minimized = false;
    renderer(main, { ok: false, error: "x" });
    await answer((c => (ask(c, req), c))(connect()));
    renderer(main, { ok: true, chats: [] });
    await answer((c => (ask(c, { list: true }), c))(connect()));
    renderer(main, draft);
    await answer((c => (ask(c, req), c))(connect()));
    assert.deepEqual([main.restored, main.shown, fake.focus.length], [1, 2, 2], "a failed draft or a list doesn't; a visible window is just shown");
});

test("socket: a request that fails inside Discord still gets an answer, so the CLI never waits forever", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    const main = mainWindow();
    main.webContents.send = () => {
        throw new Error("the renderer is gone");
    };
    fake.windows = [main];
    const conn = connect();
    ask(conn, { list: true });
    assert.deepEqual(await answer(conn), { ok: false, error: "Discord no pudo atender la petición" });
    main.webContents.send = () => {
        throw "texto";
    };
    const other = connect();
    ask(other, { list: true });
    await answer(other);
    assert.deepEqual(error.mock.calls, [["[agent-chat-bridge] CLI request failed: the renderer is gone"], ["[agent-chat-bridge] CLI request failed: texto"]]);
});

test("socket: the CLI hanging up is normal; any other connection error is logged by its code", () => {
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

test("watch: a connection listens to its chats, the renderer is told which, and only their events reach it", () => {
    const main = mainWindow();
    fake.windows = [main];
    const a = connect(), b = connect();
    a.emit("data", JSON.stringify({ watch: ["111", "222"] }) + "\n");
    b.emit("data", JSON.stringify({ watch: ["222", "333"] }) + "\n");
    assert.deepEqual(a.write.mock.calls, [[JSON.stringify({ ok: true, escuchando: ["111", "222"] }) + "\n"]]);
    assert.deepEqual(main.sent.map(([channel, ids]) => [channel, ids]), [[IPC.watchSet, ["111", "222"]], [IPC.watchSet, ["111", "222", "333"]]]);
    const get = { returnValue: undefined };
    fake.ipc.get(IPC.watchGet)(get);
    assert.deepEqual(get.returnValue, ["111", "222", "333"]);

    const event = { evento: "mensaje", chat: { id: "333" } };
    fake.ipc.get(IPC.watchEvent)({}, event);
    fake.ipc.get(IPC.watchEvent)({}, { evento: "x" });
    fake.ipc.get(IPC.watchEvent)({}, null);
    assert.equal(a.write.mock.calls.length, 1);
    assert.deepEqual(b.write.mock.calls.at(-1), [JSON.stringify(event) + "\n"]);

    b.emit("data", JSON.stringify({ list: true }) + "\n");
    assert.equal(b.end.mock.calls.length, 0, "a watch connection takes no requests");
    b.emit("close");
    assert.deepEqual(main.sent.at(-1).slice(0, 2), [IPC.watchSet, ["111", "222"]]);
    fake.windows = [];
    a.emit("close");
    fake.ipc.get(IPC.watchGet)(get);
    assert.deepEqual(get.returnValue, []);
});
