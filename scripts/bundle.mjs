// Where this copy of agent-chat-bridge keeps its files: a clone runs from its own, and a release's single executable
// (node:sea) unpacks the ones it carries into the app's folder, laid out as in the repo. The one place that tells the
// two apart.
import { homedir } from "node:os";
import { join } from "node:path";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";

import { APP_NAME } from "../mod/src/name.mts";
import { appDataDir } from "../mod/src/platform.mts";

/** The app's folder: the settings, the scheduled check's state and, in the executable, the unpacked files. */
export const STATE = join(appDataDir(process.platform, process.env, homedir()), APP_NAME);
/** The clone this runs from; the executable has none. */
export const REPO = isSea() ? null : fileURLToPath(new URL("..", import.meta.url));
/** Where the files are laid out as in the repo: the clone, or the app's folder. */
export const filesRoot = () => REPO ?? STATE;
