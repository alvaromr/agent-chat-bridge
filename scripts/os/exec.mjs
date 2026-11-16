// How the scripts run a command, the same on every system: from the repo, with its output into the log unless they
// read it, and a failure to start it as an error.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Runs a command; its output goes to the log, unless it is captured, and only then are stdout and stderr read.
 * @param {string} command
 * @param {string[]} args
 * @param {boolean} [capture]
 * @param {Record<string, string>} [env] variables added to the script's own
 */
export function exec(command, args, capture = false, env = undefined) {
    const result = spawnSync(command, args, {
        cwd: REPO, encoding: "utf8", stdio: capture ? "pipe" : "inherit", ...env ? { env: { ...process.env, ...env } } : {}
    });
    if (result.error) throw result.error;
    return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

/** A command's captured output, or an error when it fails. */
export function output(command, args) {
    const result = exec(command, args, true);
    if (!result.ok) throw new Error(`${command} failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
}
