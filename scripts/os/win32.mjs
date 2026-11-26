// Windows (partly checked, docs/decisions/windows-linux-untested.md): Discord under %LOCALAPPDATA%\Discord, one app-<version> folder per update
// (scripts/os/app-folders.mjs), PowerShell message boxes, and a scheduled task. The user can write Discord's folder,
// so `apply` runs as is.
import { rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { APP_NAME } from "../../mod/src/name.mts";
import { REPO } from "../bundle.mjs";
import { newestResources } from "./app-folders.mjs";
import { exec } from "./exec.mjs";

const DISCORD = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Discord");
const TASK = `${APP_NAME}-repatch`;

export const resources = () => newestResources(DISCORD);

export const logFile = (/** @type {string} */ state) => join(state, "repatch.log");
export const permissionHint = "";
/** Only macOS rejects an app patched before its first start (darwin.mjs): here Discord can be patched at once. */
export const patchBlocked = () => null;
// pnpm is a .cmd script there, which Node runs only through the command interpreter.
/** @type {(args: string[]) => [string, string[]]} */
export const pnpm = args => ["cmd.exe", ["/d", "/c", "pnpm", ...args]];

export const running = () => exec("tasklist", ["/FI", "IMAGENAME eq Discord.exe", "/NH"], true).stdout.includes("Discord.exe");
// Closing Discord's window only hides it in the tray: the process has to be ended.
export const quit = () => void exec("taskkill", ["/IM", "Discord.exe", "/F"]);
export const open = () => void exec(join(DISCORD, "Update.exe"), ["--processStart", "Discord.exe"]);

/** A message box, with the text in a variable so that nothing in it is read as PowerShell. */
function messageBox(text, buttons) {
    return exec("powershell.exe", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; "
        + `if ([System.Windows.Forms.MessageBox]::Show($env:ACB_TEXT, '${APP_NAME}', '${buttons}') -in 'OK','Yes') { exit 0 } else { exit 1 }`],
    true, { ACB_TEXT: text });
}

export const notify = text => void messageBox(text, "OK");

/** Whether the user chose yes. Windows' boxes have their own Yes and No buttons, so the question names the choice. */
export function ask(question, yes) {
    const answer = messageBox(`${question}\n\n${yes}?`, "YesNo");
    return { ok: answer.ok, reason: answer.ok ? "" : "No" };
}

/** The user can write Discord's folder: `apply` runs right away. */
export const runApply = (/** @type {{ apply: () => void }} */ agent) => agent.apply();

const runPath = state => join(state, "repatch-run.ps1");
/** A text PowerShell reads as it is. */
const psString = text => `'${text.replaceAll("'", "''")}'`;

/**
 * Writes the script and the hourly task that runs it hidden; Discord updates whenever it starts, so an hour is the
 * longest it stays unpatched.
 * @param {{ state: string, command: string[], path: string, log: string }} agent
 */
export function installAgent(agent) {
    const run = runPath(agent.state);
    writeFileSync(run, (REPO ? `Set-Location ${psString(REPO)}\n` : "") + `$env:PATH = ${psString(agent.path)}\n`
        + `& ${[...agent.command, "run"].map(psString).join(" ")} *>> ${psString(agent.log)}\n`);
    const command = `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${run}"`;
    if (!exec("schtasks", ["/Create", "/F", "/SC", "HOURLY", "/TN", TASK, "/TR", command]).ok)
        throw new Error(`schtasks couldn't create ${TASK}`);
    return [];
}

/** Removes the task and its script. */
export function uninstallAgent(/** @type {{ state: string }} */ agent) {
    if (exec("schtasks", ["/Query", "/TN", TASK], true).ok && !exec("schtasks", ["/Delete", "/F", "/TN", TASK]).ok)
        throw new Error(`schtasks couldn't delete ${TASK}`);
    rmSync(runPath(agent.state), { force: true });
    return [];
}
