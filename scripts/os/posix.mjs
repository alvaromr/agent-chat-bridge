// What macOS and Linux share (scripts/os/darwin.mjs, scripts/os/linux.mjs): finding Discord's process, and the shell
// script their scheduler runs, with the tools on the PATH the install ran with.
import { execFileSync } from "node:child_process";

import { REPO } from "../bundle.mjs";

/** What the user reads when a tool is missing. */
const TEXT = {
    noPgrep: "Falta pgrep, que dice si Discord está abierto: instálalo (en Debian y Ubuntu, el paquete procps) y repite."
};

/** Whether Discord's main process, named Discord on both, is running. */
export function running() {
    try {
        execFileSync("pgrep", ["-x", "Discord"], { stdio: "ignore" });
        return true;
    } catch (err) {
        if (err instanceof Error && "status" in err && err.status === 1) return false; // pgrep found no such process
        // A minimal Linux may lack it, as Debian's slim image does; every macOS has it.
        if (err instanceof Error && "code" in err && err.code === "ENOENT") throw new Error(TEXT.noPgrep);
        throw err;
    }
}

/** A shell word that stands for the text as it is. */
export const shellWord = text => `'${text.replaceAll("'", "'\\''")}'`;

/**
 * A shell script that runs a command of the re-patch (`agent.command` and `command`), from the clone if there is one,
 * into the log.
 * @param {{ command: string[], path: string, log: string }} agent
 * @param {string} command
 * @param {Record<string, string>} [env] more variables it exports, such as a desktop session's
 */
export const shellScript = (agent, command, env = {}) => (REPO ? `cd ${shellWord(REPO)} && ` : "")
    + Object.entries({ PATH: agent.path, ...env }).map(([name, value]) => `${name}=${shellWord(value)} `).join("")
    + `exec ${[...agent.command, command].map(shellWord).join(" ")} >> ${shellWord(agent.log)} 2>&1\n`;
