// Where the app's folder and the CLI's socket are on each system, defined once for mod/ (inside Discord) and for
// scripts/ (outside it, without Electron). Only erasable TypeScript, so scripts/agent-chat-bridge.mjs loads it with
// plain Node.
// Checked on macOS and Linux; on Windows, CI checks the pipe, and the app's folder follows what Electron documents
// (docs/decisions/windows-linux-untested.md).
import { APP_NAME, SOCKET_FILE } from "./name.mts";

/**
 * Electron's `app.getPath("appData")`, worked out without Electron: the folder the app's folder, settings.json and
 * Discord's own data live in.
 */
export function appDataDir(platform: string, env: Record<string, string | undefined>, home: string): string {
    if (platform === "darwin") return `${home}/Library/Application Support`;
    if (platform === "win32") return env.APPDATA ?? `${home}\\AppData\\Roaming`;
    return env.XDG_CONFIG_HOME || `${home}/.config`;
}

/**
 * The CLI's socket: a file in the app's folder, which only the user can open, or on Windows a named pipe, whose
 * default access lets only the user who created it write to it. The user's name keeps two accounts' pipes apart.
 */
export function socketPath(platform: string, appData: string, user: string): string {
    if (platform === "win32") return `\\\\.\\pipe\\${APP_NAME}-${user}-compose`;
    return `${appData}/${APP_NAME}/${SOCKET_FILE}`;
}

/** Whether the socket is a named pipe, which is no file: nothing to create, clear or restrict on disk. */
export const isPipe = (platform: string) => platform === "win32";
