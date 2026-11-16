// The CLI's socket (mod/src/compose.ts) as on Windows, a named pipe, on a fake Electron and a fake server: no folder is
// made, and nothing on disk is restricted or removed. The rest of the socket is in test/socket.test.mjs. Run with
// `pnpm test`.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, test, vi } from "vitest";

/** What the fake Electron and server were given. @type {any} */
const fake = vi.hoisted(() => ({ appData: "", listened: [], quit: null, closed: 0, disk: [] }));
vi.mock("electron", () => ({
    app: { getPath: () => fake.appData, on: (event, listener) => void (event === "will-quit" && (fake.quit = listener)) },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { on: () => { } }
}));
vi.mock("net", () => ({
    Socket: class { },
    createServer: () => ({ listen: (path, ready) => void (fake.listened.push(path), ready()), close: () => void fake.closed++ })
}));
vi.mock("os", async original => ({ ...(/** @type {any} */ (await original())), userInfo: () => ({ username: "ana" }) }));
/** Every change on disk the socket makes; a pipe needs none. */
vi.mock("fs", async original => {
    const fs = /** @type {any} */ (await original());
    const record = name => (...args) => void fake.disk.push([name, ...args]);
    return { ...fs, mkdirSync: record("mkdir"), rmSync: record("rm"), chmodSync: record("chmod") };
});

fake.appData = mkdtempSync(join(tmpdir(), "agent-chat-bridge-pipe-"));
const platform = Object.getOwnPropertyDescriptor(process, "platform");
Object.defineProperty(process, "platform", { value: "win32" });
afterAll(() => {
    Object.defineProperty(process, "platform", /** @type {PropertyDescriptor} */ (platform));
    rmSync(fake.appData, { recursive: true, force: true });
});

const { startComposeServer } = await import("../mod/src/compose.ts");

test("socket: on Windows it listens on the user's named pipe, with no folder or file of its own", () => {
    startComposeServer();
    assert.deepEqual(fake.listened, ["\\\\.\\pipe\\agent-chat-bridge-ana-compose"]);
    assert.equal(existsSync(join(fake.appData, "agent-chat-bridge")), false);
    fake.quit();
    assert.equal(fake.closed, 1);
    assert.deepEqual(fake.disk, []);
});
