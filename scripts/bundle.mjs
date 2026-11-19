// Where this copy of agent-chat-bridge keeps its files: a clone runs from its own, and a release's single executable
// (node:sea) unpacks the ones it carries into the app's folder, laid out as in the repo. The one place that tells the
// two apart.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAsset, isSea } from "node:sea";
import { fileURLToPath } from "node:url";

import { APP_NAME } from "../mod/src/name.mts";
import { appDataDir } from "../mod/src/platform.mts";

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
/** The app folder's subfolders that hold only unpacked files, replaced whole, so no file of an older version stays. */
export const UNPACKED = ["mod", "plugins", "skills"];

/** Puts the files the executable carries into the app's folder. */
export function unpack() {
    const files = /** @type {string[]} */ (JSON.parse(getAsset(MANIFEST, "utf8")));
    for (const file of files) {
        const parts = file.split("/");
        // split returns at least one part.
        if (!UNPACKED.includes(/** @type {string} */ (parts[0])) || parts.includes("..")) throw new Error(`Unexpected file in the executable: ${file}`);
    }
    for (const dir of UNPACKED) rmSync(join(STATE, dir), { recursive: true, force: true });
    for (const file of files) {
        const target = join(STATE, ...file.split("/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, new Uint8Array(getAsset(file)));
    }
}
