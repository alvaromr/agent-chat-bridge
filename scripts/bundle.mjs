// Where this copy of agent-chat-bridge keeps its files: a clone runs from its own, and a release's single executable
// (node:sea) unpacks the ones it carries into the app's folder, laid out as in the repo. The one place that tells the
// two apart.
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAsset, isSea } from "node:sea";
import { fileURLToPath } from "node:url";

import { APP_NAME } from "../mod/src/name.mts";
import { appDataDir } from "../mod/src/platform.mts";
import pkg from "../package.json" with { type: "json" };

/** The version this executable or clone is. */
export const VERSION = pkg.version;
/** The name of a system's executable among a release's files. */
export const executableName = (/** @type {string} */ platform, /** @type {string} */ arch) =>
    `${APP_NAME}-${platform === "win32" ? "win" : platform}-${arch}${platform === "win32" ? ".exe" : ""}`;

/** Whether this runs as the release's executable, not from a clone. */
export const INSTALLED = isSea();
/** The app's folder: the settings, the scheduled check's state and, in the executable, the unpacked files. */
export const STATE = join(appDataDir(process.platform, process.env, homedir()), APP_NAME);
/** The clone this runs from; the executable has none. */
export const REPO = INSTALLED ? null : fileURLToPath(new URL("..", import.meta.url));
/** Where the files are laid out as in the repo: the clone, or the app's folder. */
export const filesRoot = () => REPO ?? STATE;
/** The patch's entry, which the loader in Discord's app.asar requires. */
export const modMain = () => join(filesRoot(), "mod", "dist", "main.js");

/** The executable's list of the files it carries, as their paths in the repo, each an asset of that name. */
export const MANIFEST = "files.json";
/**
 * The app folder's subfolders that hold only unpacked files, replaced whole, so no file of an older version stays.
 * dictation/ is overwritten instead: beside its files it keeps the worker's packages, which `install --dictation`
 * installed there; tools/ holds the programs the executable carries, such as Dictation's uv.
 */
const REPLACED = ["mod", "plugins", "skills"];
/** Every subfolder of the app's folder that unpacked files go into, which `uninstall` removes. */
export const UNPACKED = [...REPLACED, "dictation", "tools"];
/** Where the executable's uv is, once unpacked: only the macOS executable for Apple Silicon carries Dictation. */
export const UV = join(STATE, "tools", "uv");

/** Puts the files the executable carries into the app's folder; the programs in tools/ can run. */
export function unpack() {
    const files = /** @type {string[]} */ (JSON.parse(getAsset(MANIFEST, "utf8")));
    for (const file of files) {
        const parts = file.split("/");
        // split returns at least one part.
        if (!UNPACKED.includes(/** @type {string} */ (parts[0])) || parts.includes("..")) throw new Error(`Unexpected file in the executable: ${file}`);
    }
    for (const dir of REPLACED) rmSync(join(STATE, dir), { recursive: true, force: true });
    for (const file of files) {
        const target = join(STATE, ...file.split("/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, new Uint8Array(getAsset(file)));
        if (file.startsWith("tools/")) chmodSync(target, 0o755);
    }
}
