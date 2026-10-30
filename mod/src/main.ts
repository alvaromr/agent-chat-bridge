// Main-process loader, required by the app.asar shim that scripts/inject.mjs writes. Ends by loading Discord's _app.asar.
// It leaves Discord's preload, sandbox, CSP and devtools as they are.
import { app, dialog, ipcMain, session } from "electron";
import { readFileSync } from "fs";
import { dirname, join } from "path";

import { runClaude } from "../../plugins/shared/run";
import { startComposeServer } from "./compose";
import { IPC } from "./ipc";
import { settingsFile } from "./settingsFile";

// Discord's own code sits at a path known only at run time, so it loads with require, not an import.
/* eslint-disable @typescript-eslint/no-require-imports */
// The entry module is the loader's index.js in Discord's app.asar; scripts/inject.mjs is the only way main.ts loads.
const entry = require.main;
if (!entry) throw new Error("[discord-mod] main.js must be loaded by the app.asar loader that scripts/inject.mjs writes");
const asarPath = join(dirname(entry.filename), "..", "_app.asar");
const discordPkg = require(join(asarPath, "package.json"));
entry.filename = join(asarPath, discordPkg.main);
app.setAppPath(asarPath);

ipcMain.on(IPC.getRenderer, e => {
    e.returnValue = readFileSync(join(__dirname, "renderer.js"), "utf8");
});
const settings = settingsFile(join(app.getPath("appData"), "discord-mod", "settings.json"));
ipcMain.on(IPC.getSettings, e => {
    const { settings: saved, problem } = settings.read();
    if (problem) dialog.showMessageBox({ type: "warning", message: "discord-mod", detail: problem });
    e.returnValue = saved;
});
ipcMain.handle(IPC.setSettings, (_, saved) => settings.write(saved));
ipcMain.handle(IPC.runClaude, runClaude);

// Registered before Discord's own "ready" listener, so it is in place before Discord opens any window.
// A session preload runs before the window's preload, which keeps being Discord's.
app.once("ready", () => {
    session.defaultSession.registerPreloadScript({ type: "frame", id: "discord-mod", filePath: join(__dirname, "preload.js") });
    startComposeServer();
});

require(entry.filename);
