// The system the scripts run on. Each module in this folder answers the same questions (where Discord is, how to quit
// and open it, ask the user, run the check on a schedule) for its system; what all share stays in the callers.
import * as darwin from "./darwin.mjs";
import * as linux from "./linux.mjs";
import * as win32 from "./win32.mjs";

/** @typedef {typeof darwin | typeof linux | typeof win32} System */

/** @type {Record<string, System>} */
const SYSTEMS = { darwin, linux, win32 };

/** The module for `platform`, or an error for a system none covers. */
export function systemFor(platform) {
    const system = SYSTEMS[platform];
    if (!system) throw new Error(`Sistema no soportado: ${platform}. agent-chat-bridge funciona en macOS, Windows y Linux.`);
    return system;
}

export const system = systemFor(process.platform);
