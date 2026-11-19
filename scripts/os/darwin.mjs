// macOS (tested): Discord in /Applications, AppleScript dialogs, a LaunchAgent, and a helper app that patches Discord.
// macOS lets only an app with its App Management permission change another app, and grants it to one exact build: so
// the helper stays the same build, and what it runs lives in a script beside it.
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";

import { APP_NAME } from "../../mod/src/name.mts";
import { REPO } from "../bundle.mjs";
import { exec, output } from "./exec.mjs";
import { running, shellScript, shellWord } from "./posix.mjs";

export { running };

const RESOURCES = "/Applications/Discord.app/Contents/Resources";
const LABEL = `local.${APP_NAME}.repatch`;
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
/** The helper's name says what it does, as the user sees it in macOS's App Management list. */
const HELPER_NAME = `Reparchear Discord (${APP_NAME})`;
/** How often launchd runs the check besides login and Discord's changes: daily, for new releases. */
const CHECK_INTERVAL_S = 86_400;

/** What the user reads on macOS only. */
const TEXT = {
    grant: `Falta un paso: arrastra «${HELPER_NAME}», que te he mostrado en el Finder, a Ajustes → Privacidad y `
        + "seguridad → Gestión de las apps, que te he abierto, y actívala. Sin ese permiso, macOS no la deja parchear Discord.",
    revoke: `Quita «${HELPER_NAME}» de Gestión de las apps.`,
    permission: `Si dice EPERM, activa «${HELPER_NAME}» en Ajustes → Privacidad y seguridad → Gestión de las apps.`
};

export const resources = () => existsSync(RESOURCES) ? RESOURCES : null;
export const logFile = () => join(homedir(), "Library", "Logs", `${APP_NAME}-repatch.log`);
export const permissionHint = TEXT.permission;
/** @type {(args: string[]) => [string, string[]]} */
export const pnpm = args => ["pnpm", args];

const quoted = text => JSON.stringify(text);

// AppleScript would start a closed Discord in order to quit it: the caller quits only a running one.
export const quit = () => void exec("osascript", ["-e", 'quit app "Discord"']);
export const open = () => void exec("open", ["-a", "Discord"]);
export const notify = text => void exec("osascript", ["-e", `display notification ${quoted(text)} with title ${quoted(APP_NAME)}`]);

/** Whether the user chose `yes`; `no` is the cancel button, so it answers with an error. */
export function ask(question, yes, no) {
    const answer = exec("osascript", ["-e", `display dialog ${quoted(question)} with title ${quoted(APP_NAME)}`
        + ` buttons {${quoted(no)}, ${quoted(yes)}} default button ${quoted(yes)} cancel button ${quoted(no)} with icon caution`], true);
    return { ok: answer.ok, reason: answer.stderr.trim() };
}

const helperPath = state => join(state, `${HELPER_NAME}.app`);
const applyPath = state => join(state, "repatch-apply.sh");
const runPath = state => join(state, "repatch-run.sh");

/** The helper patches Discord: it runs `apply` with its permission, which the agent lacks. */
export const runApply = (/** @type {{ state: string }} */ agent) => void exec("open", [helperPath(agent.state)]);

/**
 * Builds the helper app, unless the one there already runs the same AppleScript: a new build, even of the same
 * source, loses the permission macOS granted to the old one. Returns whether it built one.
 */
function buildHelper(state) {
    const helper = helperPath(state);
    const source = `do shell script ${quoted(`/bin/sh ${shellWord(applyPath(state))}`)}`;
    const compiled = join(helper, "Contents", "Resources", "Scripts", "main.scpt");
    if (existsSync(compiled) && output("osadecompile", [compiled]) === source) return false;
    rmSync(helper, { recursive: true, force: true });
    output("osacompile", ["-o", helper, "-e", source]);
    // Its executable and bundle name are what the App Management list shows.
    const info = join(helper, "Contents", "Info.plist");
    renameSync(join(helper, "Contents", "MacOS", "applet"), join(helper, "Contents", "MacOS", HELPER_NAME));
    for (const [key, value] of [["CFBundleExecutable", HELPER_NAME], ["CFBundleName", HELPER_NAME], ["CFBundleIdentifier", `${LABEL}.helper`]])
        output("plutil", ["-replace", key, "-string", value, info]);
    output("codesign", ["--force", "--sign", "-", helper]);
    return true;
}

/** The LaunchAgent: at login, when /Applications or Discord's Resources change, and daily. */
function launchAgent(state, log) {
    const string = value => `<string>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</string>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>${string(LABEL)}
    <key>ProgramArguments</key>
    <array>${string("/bin/sh")}${string(runPath(state))}</array>${REPO ? `
    <key>WorkingDirectory</key>${string(REPO)}` : ""}
    <key>WatchPaths</key>
    <array>${string("/Applications")}${string(RESOURCES)}</array>
    <key>RunAtLoad</key><true/>
    <key>StartInterval</key><integer>${CHECK_INTERVAL_S}</integer>
    <key>StandardOutPath</key>${string(log)}
    <key>StandardErrorPath</key>${string(log)}
</dict>
</plist>
`;
}

const domain = () => `gui/${userInfo().uid}`;

function unload() {
    if (exec("launchctl", ["print", `${domain()}/${LABEL}`], true).ok && !exec("launchctl", ["bootout", domain(), PLIST]).ok)
        throw new Error(`launchctl couldn't unload ${LABEL}`);
}

/**
 * Writes the scripts, the helper and the LaunchAgent, and loads it; returns what the user still has to do.
 * @param {{ state: string, command: string[], path: string, log: string }} agent
 */
export function installAgent(agent) {
    unload();
    writeFileSync(applyPath(agent.state), shellScript(agent, "apply"));
    writeFileSync(runPath(agent.state), shellScript(agent, "run"));
    const built = buildHelper(agent.state);
    mkdirSync(dirname(PLIST), { recursive: true });
    writeFileSync(PLIST, launchAgent(agent.state, agent.log));
    if (!exec("launchctl", ["bootstrap", domain(), PLIST]).ok) throw new Error(`launchctl couldn't load ${PLIST}`);
    if (!built) return [];
    exec("open", ["-R", helperPath(agent.state)]);
    exec("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles"]);
    return [TEXT.grant];
}

/** Unloads and removes the LaunchAgent, the helper and its scripts; returns what the user still has to do. */
export function uninstallAgent(/** @type {{ state: string }} */ agent) {
    unload();
    for (const file of [PLIST, helperPath(agent.state), applyPath(agent.state), runPath(agent.state)]) rmSync(file, { recursive: true, force: true });
    return [TEXT.revoke];
}
