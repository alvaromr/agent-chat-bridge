// The session preload (mod/src/preload.ts) on a fake Electron: only Discord's own page gets the mod, what it exposes
// maps to the main process's channels, and each handler can be set once. Run with `pnpm test`.
import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

/** What the fake Electron was given. @type {any} */
const fake = vi.hoisted(() => ({ exposed: new Map(), listeners: new Map(), sent: [], invoked: [], sync: [], executed: [] }));
vi.mock("electron", () => ({
    contextBridge: { exposeInMainWorld: (key, api) => void fake.exposed.set(key, api) },
    ipcRenderer: {
        sendSync: (channel, ...args) => (fake.sync.push([channel, ...args]), `sync:${channel}`),
        invoke: async (channel, ...args) => (fake.invoked.push([channel, ...args]), `invoked:${channel}`),
        send: (channel, ...args) => void fake.sent.push([channel, ...args]),
        on: (channel, listener) => void fake.listeners.set(channel, [...fake.listeners.get(channel) ?? [], listener])
    },
    webFrame: { executeJavaScript: code => void fake.executed.push(code) }
}));

const { IPC } = await import("../mod/src/ipc.ts");

/** Loads the preload afresh in a frame of that origin. */
async function preloadIn(origin) {
    vi.resetModules();
    for (const list of [fake.sent, fake.invoked, fake.sync, fake.executed]) list.length = 0;
    fake.exposed.clear();
    fake.listeners.clear();
    vi.stubGlobal("location", { origin });
    await import("../mod/src/preload.ts");
    return fake.exposed.get("AgentChatBridgeNative");
}
/** The main process sends on a channel the preload listens to. */
const fromMain = (channel, ...args) => Promise.all((fake.listeners.get(channel) ?? []).map(listener => listener({}, ...args)));

let api;
beforeEach(async () => {
    vi.unstubAllGlobals();
    api = await preloadIn("https://discord.com");
});

test("preload: the splash screen and other local pages of the session get nothing", async () => {
    assert.equal(await preloadIn("file://"), undefined);
    assert.deepEqual(fake.executed, []);
});

test("preload: Discord's page gets the renderer, run in its own world before Discord's scripts", () => {
    assert.deepEqual(fake.executed, [`sync:${IPC.getRenderer}`]);
});

test("preload: the settings and Claude go to their channels", async () => {
    assert.equal(api.getSettings(), `sync:${IPC.getSettings}`);
    assert.equal(await api.setSettings({ a: 1 }), `invoked:${IPC.setSettings}`);
    assert.equal(await api.runClaude("s", "i", "m"), `invoked:${IPC.runClaude}`);
    assert.deepEqual(fake.invoked, [[IPC.setSettings, { a: 1 }], [IPC.runClaude, "s", "i", "m"]]);
});

test("preload: the CLI's requests reach the first handler only, and its answer, or its failure, goes back with the id", async () => {
    const first = vi.fn(async req => ({ ok: true, echo: req }));
    api.onComposeRequest(first);
    api.onComposeRequest(async () => ({ ok: true, from: "other" }));
    assert.equal(fake.listeners.get(IPC.composeRequest).length, 1);
    await fromMain(IPC.composeRequest, 7, { list: true });
    assert.deepEqual(fake.sent, [[IPC.composeResponse, 7, { ok: true, echo: { list: true } }]]);
    first.mockRejectedValueOnce(new Error("roto"));
    await fromMain(IPC.composeRequest, 8, { list: true });
    assert.deepEqual(fake.sent[1], [IPC.composeResponse, 8, { ok: false, error: "Error: roto" }]);
});

test("preload: the watched chats reach the first handler, now and on each change; its events go to the main process", async () => {
    const first = vi.fn(), second = vi.fn();
    api.onWatchChange(first);
    api.onWatchChange(second);
    assert.deepEqual(first.mock.calls, [[`sync:${IPC.watchGet}`]]);
    assert.equal(second.mock.calls.length, 0);
    assert.equal(fake.listeners.get(IPC.watchSet).length, 1);
    await fromMain(IPC.watchSet, ["1"]);
    assert.deepEqual(first.mock.calls[1], [["1"]]);
    api.emitWatchEvent({ evento: "x" });
    assert.deepEqual(fake.sent, [[IPC.watchEvent, { evento: "x" }]]);
});

test("preload: the dictation goes to its channels, and its texts reach the first handler only", async () => {
    const { dictation } = api;
    assert.equal(dictation.models(), `sync:${IPC.dictationModels}`);
    assert.equal(await dictation.start({ model: "m" }), `invoked:${IPC.dictationStart}`);
    const samples = new Float32Array(2);
    dictation.audio(samples);
    dictation.stop();
    dictation.cancel();
    assert.deepEqual(fake.sent, [[IPC.dictationAudio, samples], [IPC.dictationStop], [IPC.dictationCancel]]);
    const first = vi.fn();
    dictation.onEvent(first);
    dictation.onEvent(vi.fn());
    await fromMain(IPC.dictationEvent, { type: "done" });
    assert.deepEqual(first.mock.calls, [[{ type: "done" }]]);
    assert.equal(fake.listeners.get(IPC.dictationEvent).length, 1);
});
