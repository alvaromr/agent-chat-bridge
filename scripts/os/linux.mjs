// Linux (README «Requirements»): the .deb or .tar.gz only bootstraps Discord, which installs itself into
// ~/.config/discord, one app-<version> folder per update (scripts/os/app-folders.mjs), and the user can write it, so
// `apply` runs as is. zenity dialogs, notify-send, and systemd user units. Flatpak and Snap are not supported.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { APP_NAME } from "../../mod/src/name.mts";
import { appDataDir } from "../../mod/src/platform.mts";
import { newestResources } from "./app-folders.mjs";
import { exec } from "./exec.mjs";
import { running, shellScript, shellWord } from "./posix.mjs";

export { running };

// Stryker disable next-line StringLiteral: Linux is appDataDir's last case, which any other name falls to as well.
const CONFIG = appDataDir("linux", process.env, homedir());
const UNIT = `${APP_NAME}-repatch`;
const UNITS = join(CONFIG, "systemd", "user");
/** What a desktop dialog needs from the session that installed the units, which systemd doesn't pass on. */
const SESSION = ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"];

export const resources = () => newestResources(join(CONFIG, "discord"));
export const logFile = (/** @type {string} */ state) => join(state, "repatch.log");
export const permissionHint = "";
/** @type {(args: string[]) => [string, string[]]} */
export const pnpm = args => ["pnpm", args];

export const quit = () => void exec("pkill", ["-x", "Discord"]);
// Detached, so the check doesn't wait for Discord to close.
export const open = () => void exec("sh", ["-c", "setsid -f discord >/dev/null 2>&1"]);
/**
 * A UTF-8 locale for the desktop tools: without one, as a systemd unit may start, zenity rejects any text with
 * accents ("This option is not available", seen with Debian 12's zenity 3.44).
 */
const UTF8 = { LC_ALL: "C.UTF-8" };

export const notify = text => void exec("notify-send", [APP_NAME, text], false, UTF8);

/** Whether the user chose `yes`. Without zenity there is no dialog, which is a no, and the reason says so. */
export function ask(question, yes, no) {
    const answer = exec("zenity", ["--question", `--title=${APP_NAME}`, `--text=${question}`, `--ok-label=${yes}`, `--cancel-label=${no}`, "--no-markup"], true, UTF8);
    return { ok: answer.ok, reason: answer.stderr.trim() };
}

/** The user can write Discord's folder: `apply` runs right away. */
export const runApply = (/** @type {{ apply: () => void }} */ agent) => agent.apply();

const unitText = agent => ({
    [`${UNIT}.service`]: `[Unit]\nDescription=${APP_NAME}: re-patch Discord and offer new releases\n\n`
        + `[Service]\nType=oneshot\nExecStart=/bin/sh ${shellWord(join(agent.state, "repatch-run.sh"))}\n`,
    [`${UNIT}.timer`]: `[Unit]\nDescription=${APP_NAME}: hourly check\n\n[Timer]\nOnStartupSec=2min\nOnUnitActiveSec=1h\n\n`
        + "[Install]\nWantedBy=timers.target\n"
});

const systemctl = args => {
    if (!exec("systemctl", ["--user", ...args]).ok) throw new Error(`systemctl --user ${args.join(" ")} failed`);
};

/**
 * Writes the script and the units: the check runs two minutes after login and hourly. Discord updates when it starts,
 * as on Windows, so an hour is the longest it stays unpatched.
 * @param {{ state: string, command: string[], path: string, log: string }} agent
 */
export function installAgent(agent) {
    const session = Object.fromEntries(SESSION.flatMap(name => process.env[name] ? [[name, process.env[name]]] : []));
    writeFileSync(join(agent.state, "repatch-run.sh"), shellScript(agent, "run", session));
    mkdirSync(UNITS, { recursive: true });
    for (const [name, text] of Object.entries(unitText(agent))) writeFileSync(join(UNITS, name), text);
    systemctl(["daemon-reload"]);
    systemctl(["enable", "--now", `${UNIT}.timer`]);
    return [];
}

/** Stops and removes the units and the script. */
export function uninstallAgent(/** @type {{ state: string }} */ agent) {
    // Units that were never installed fail to disable, which an uninstall allows: systemctl prints why in any case.
    exec("systemctl", ["--user", "disable", "--now", `${UNIT}.timer`]);
    for (const name of ["service", "timer"]) rmSync(join(UNITS, `${UNIT}.${name}`), { force: true });
    rmSync(join(agent.state, "repatch-run.sh"), { force: true });
    systemctl(["daemon-reload"]);
    return [];
}
