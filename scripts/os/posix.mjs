// What macOS and Linux share (scripts/os/darwin.mjs, scripts/os/linux.mjs): finding Discord's process, and the shell
// script their scheduler runs, with the tools on the PATH the install ran with.
import { execFileSync } from "node:child_process";

import { REPO } from "./exec.mjs";

/** Whether Discord's main process, named Discord on both, is running. */
export function running() {
    try {
        execFileSync("pgrep", ["-x", "Discord"], { stdio: "ignore" });
        return true;
    } catch (err) {
        if (err instanceof Error && "status" in err && err.status === 1) return false; // pgrep found no such process
        throw err;
    }
}

/** A shell word that stands for the text as it is. */
export const shellWord = text => `'${text.replaceAll("'", "'\\''")}'`;

/**
 * A shell script that runs a scripts/repatch.mjs command from the repo, into the log.
 * @param {{ script: string, path: string, log: string }} agent
 * @param {string} command
 * @param {Record<string, string>} [env] more variables it exports, such as a desktop session's
 */
export const shellScript = (agent, command, env = {}) => `cd ${shellWord(REPO)} && `
    + Object.entries({ PATH: agent.path, ...env }).map(([name, value]) => `${name}=${shellWord(value)} `).join("")
    + `exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON ${shellWord(agent.script)} ${command} >> ${shellWord(agent.log)} 2>&1\n`;
