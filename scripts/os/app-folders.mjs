// What Windows and Linux share (scripts/os/win32.mjs, scripts/os/linux.mjs): Discord installs itself into the user's
// folder, one app-<version> folder per update, and starts the newest; the older ones stay behind. Seen on Linux
// (Discord 1.0.169, ~/.config/discord/app-1.0.169/resources); on Windows, as its installer has always done. macOS
// keeps app-<version> folders too, but the newest isn't always the one that runs (scripts/os/darwin.mjs).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** An app folder's version as numbers, or null for any other folder. */
const appVersion = name => name.match(/^app-(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number) ?? null;
const newer = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The newest app folder's resources in `discord`, or null when there is none. */
export function newestResources(discord) {
    if (!existsSync(discord)) return null;
    const apps = readdirSync(discord).filter(name => appVersion(name));
    const newest = apps.sort((a, b) => newer(/** @type {number[]} */ (appVersion(b)), /** @type {number[]} */ (appVersion(a))))[0];
    return newest ? join(discord, newest, "resources") : null;
}
