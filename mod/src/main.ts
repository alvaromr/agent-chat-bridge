// Main-process loader, required by the app.asar shim that scripts/inject.mjs writes. Ends by loading Discord's _app.asar.
// It leaves Discord's preload, sandbox, CSP and devtools as they are.
import { app, ipcMain, session } from "electron";
import { readFileSync } from "fs";
import { dirname, join } from "path";

import { runClaude } from "../../plugins/shared/run";
import { startComposeServer } from "./compose";
import { IPC } from "./ipc";
import { readSettings, writeSettings } from "./settingsFile";

// Discord's own code sits at a path known only at run time, so it loads with require, not an import.
/* eslint-disable @typescript-eslint/no-require-imports */
const asarPath = join(dirname(require.main!.filename), "..", "_app.asar");
const discordPkg = require(join(asarPath, "package.json"));
require.main!.filename = join(asarPath, discordPkg.main);
app.setAppPath(asarPath);

ipcMain.on(IPC.getRenderer, e => {
    e.returnValue = readFileSync(join(__dirname, "renderer.js"), "utf8");
});
const SETTINGS = join(app.getPath("appData"), "discord-mod", "settings.json");
ipcMain.on(IPC.getSettings, e => {
    e.returnValue = readSettings(SETTINGS);
});
ipcMain.handle(IPC.setSettings, (_, settings) => writeSettings(SETTINGS, settings));
ipcMain.handle(IPC.runClaude, runClaude);

// Registered before Discord's own "ready" listener, so it is in place before Discord opens any window.
// A session preload runs before the window's preload, which keeps being Discord's.
app.once("ready", () => {
    session.defaultSession.registerPreloadScript({ type: "frame", id: "discord-mod", filePath: join(__dirname, "preload.js") });
    startComposeServer();
});

require(require.main!.filename);
