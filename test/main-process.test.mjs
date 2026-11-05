// The main-process loader (mod/src/main.ts) on a fake Electron, with a made-up Discord app next to the loader's in a
// temporary folder: it only starts from the loader that scripts/inject.mjs writes, hands over to Discord's own app,
// and registers the IPC handlers and the session preload. Run with `pnpm test`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, test, vi } from "vitest";

/** What the fake Electron was given. @type {any} */
const fake = vi.hoisted(() => ({ appData: "", appPath: "", ipc: new Map(), ready: null, preloads: [], dialogs: [] }));
vi.mock("electron", () => ({
    app: {
        getPath: name => name === "appData" ? fake.appData : "",
        setAppPath: path => void (fake.appPath = path),
        once: (event, listener) => void (event === "ready" && (fake.ready = listener))
    },
    dialog: { showMessageBox: options => void fake.dialogs.push(options) },
    ipcMain: {
        on: (channel, listener) => void fake.ipc.set(channel, listener),
        handle: (channel, listener) => void fake.ipc.set(channel, listener)
    },
    session: { defaultSession: { registerPreloadScript: script => void fake.preloads.push(script) } }
}));
const started = vi.hoisted(() => ({ compose: 0 }));
vi.mock("../mod/src/compose.ts", () => ({ startComposeServer: () => void started.compose++ }));
// mod/dist/ holds the renderer the preload asks for; here, next to the source.
vi.mock("fs", async original => {
    const fs = /** @type {any} */ (await original());
    return { ...fs, readFileSync: (path, ...rest) => String(path).endsWith("renderer.js") ? "/* renderer */" : fs.readFileSync(path, ...rest) };
});

// Discord's resources: the loader's app.asar (whose index.js requires main.js) and Discord's own, renamed _app.asar.
const root = mkdtempSync(join(tmpdir(), "agent-chat-bridge-main-"));
afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.mainModule;
});
fake.appData = join(root, "Application Support");
const resources = join(root, "Discord.app/Contents/Resources");
mkdirSync(join(resources, "app.asar"), { recursive: true });
mkdirSync(join(resources, "_app.asar/app_bootstrap"), { recursive: true });
writeFileSync(join(resources, "_app.asar/package.json"), JSON.stringify({ main: "app_bootstrap/index.js" }));
writeFileSync(join(resources, "_app.asar/app_bootstrap/index.js"), "globalThis.discordStarted = (globalThis.discordStarted ?? 0) + 1;");

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../mod/src");
const { IPC } = await import("../mod/src/ipc.ts");

// Loaded here, not inside a test, so every test below checks what loading it did.
const refusal = await import("../mod/src/main.ts").then(() => null, err => err);
vi.resetModules();
const entry = { filename: join(resources, "app.asar/index.js") };
process.mainModule = /** @type {any} */ (entry);
await import("../mod/src/main.ts");

test("main: loaded any other way than by the loader, it refuses to start", () => {
    assert.equal(refusal?.message, "[agent-chat-bridge] main.js must be loaded by the app.asar loader that scripts/inject.mjs writes");
});

test("main: Discord's own app starts, from its _app.asar, with Electron told it is the app", () => {
    assert.equal(entry.filename, join(resources, "_app.asar/app_bootstrap/index.js"));
    assert.equal(fake.appPath, join(resources, "_app.asar"));
    assert.equal(/** @type {any} */ (globalThis).discordStarted, 1);
});

test("main: before Discord opens a window, the session preload is the mod's and the CLI's socket starts", () => {
    assert.equal(fake.preloads.length, 0);
    fake.ready();
    assert.deepEqual(fake.preloads, [{ type: "frame", id: "agent-chat-bridge", filePath: join(SRC, "preload.js") }]);
    assert.equal(started.compose, 1);
});

test("main: the preload gets the renderer's code", () => {
    const event = { returnValue: undefined };
    fake.ipc.get(IPC.getRenderer)(event);
    assert.equal(event.returnValue, "/* renderer */");
});

test("main: the settings come from the app's folder; one that can't be read is reported, and saving writes it", async () => {
    const event = { returnValue: undefined };
    fake.ipc.get(IPC.getSettings)(event);
    assert.deepEqual([event.returnValue, fake.dialogs.length], [{}, 0], "none yet");
    await fake.ipc.get(IPC.setSettings)({}, { Corrector: { model: "m" } });
    assert.deepEqual(JSON.parse(readFileSync(join(fake.appData, "agent-chat-bridge/settings.json"), "utf8")), { Corrector: { model: "m" } });
    fake.ipc.get(IPC.getSettings)(event);
    assert.deepEqual(event.returnValue, { Corrector: { model: "m" } });
    writeFileSync(join(fake.appData, "agent-chat-bridge/settings.json"), "{");
    fake.ipc.get(IPC.getSettings)(event);
    assert.deepEqual(event.returnValue, {});
    assert.equal(fake.dialogs.length, 1);
    assert.deepEqual([fake.dialogs[0].type, fake.dialogs[0].message], ["warning", "agent-chat-bridge"]);
    assert.match(fake.dialogs[0].detail, /settings\.json/);
});

test("main: Claude and the dictation answer on their channels", async () => {
    const { runClaude } = await import("../plugins/shared/run.ts");
    const dictation = await import("../plugins/dictation/main.ts");
    assert.equal(fake.ipc.get(IPC.runClaude), runClaude);
    assert.equal(fake.ipc.get(IPC.dictationModels), dictation.dictationModels);
    assert.equal(fake.ipc.get(IPC.dictationStart), dictation.startDictation);
    assert.equal(fake.ipc.get(IPC.dictationAudio), dictation.dictationAudio);
    assert.equal(fake.ipc.get(IPC.dictationStop), dictation.stopDictation);
    assert.equal(fake.ipc.get(IPC.dictationCancel), dictation.cancelDictation);
});
