// Offers to re-patch Discord after an update replaces it (AGENTS.md, «When Discord updates»). `install` adds a
// LaunchAgent that runs `run` at login and whenever /Applications or Discord's Resources change; `uninstall` removes it.
// `run` patches nothing on its own: once per Discord version that lost the patch, it checks the new Discord with
// `pnpm check-discord` and a clean tree (the review of a re-patch without changes, AGENTS.md «Review»), then asks.
// Only on the user's yes does it quit Discord and open the helper app, which runs `apply`: it rebuilds mod/dist/,
// patches Discord and reopens it. macOS lets only an app with its App Management permission change another app, and
// grants it to one exact build: so the helper stays the same build, and what it runs lives in a script beside it.
// `run` also offers each new release, once a day, to a clone installed at a release tag (README, «Update»): on a yes it
// checks the new tag out, sets it up and reloads Discord the same way. A development clone is never touched.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { APP_NAME } from "../mod/src/name.mts";
import { discordRunning, ORIGINAL, RESOURCES } from "./discord-app.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const LABEL = `local.${APP_NAME}.repatch`;
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG = join(homedir(), "Library", "Logs", `${APP_NAME}-repatch.log`);
const APP_FOLDER = join(homedir(), "Library", "Application Support", APP_NAME);
/**
 * The last Discord version this script saw, patched or not: it asks once per version, and a patch removed by hand
 * (`pnpm uninject`) keeps the version, so it asks nothing.
 */
const SEEN = join(APP_FOLDER, "repatch-seen-version");
/** The last release offered: it offers each one once. */
const RELEASE_SEEN = join(APP_FOLDER, "update-seen-release");
/** The helper's name says what it does, as the user sees it in macOS's App Management list. */
const HELPER_NAME = `Reparchear Discord (${APP_NAME})`;
const HELPER = join(APP_FOLDER, `${HELPER_NAME}.app`);
/** What the helper runs, rewritten by each install: the helper itself never changes. */
const APPLY = join(APP_FOLDER, "repatch-apply.sh");
const INFO_PLIST = join(dirname(RESOURCES), "Info.plist");

/** An update rewrites the app for a while: the check waits for it to settle. */
const SETTLE_MS = 30_000;
/** How long Discord gets to quit before the re-patch gives up. */
const QUIT_WAIT_MS = 30_000;
const POLL_MS = 1_000;
/** How often launchd runs the check besides login and Discord's changes: daily, for new releases. */
const CHECK_INTERVAL_S = 86_400;
/** A release's notes in the dialog, cut to what a dialog shows. */
const MAX_NOTES = 800;

/** What the user reads, in a dialog or a notification. */
const TEXT = {
    usage: "Uso: node scripts/repatch.mjs install|uninstall|run|apply",
    installed: "Instalado: al actualizarse Discord, se te preguntará si volver a parchearlo, y al salir una versión nueva "
        + `de agent-chat-bridge, si instalarla. El registro está en ${LOG}.`,
    grant: `Falta un paso: arrastra «${HELPER_NAME}», que te he mostrado en el Finder, a Ajustes → Privacidad y `
        + "seguridad → Gestión de las apps, que te he abierto, y actívala. Sin ese permiso, macOS no la deja parchear Discord.",
    uninstalled: `Desinstalado: Discord ya no se vuelve a parchear tras actualizarse. Quita «${HELPER_NAME}» de Gestión de las apps.`,
    question: version => `Discord se ha actualizado a ${version} y ha perdido el parche de agent-chat-bridge. `
        + "pnpm check-discord da por bueno el parche con el código nuevo. "
        + "¿Lo vuelvo a parchear? Discord se cerrará y se volverá a abrir; si estás en una llamada, se cortará. "
        + "Si no, ejecuta pnpm inject cuando quieras.",
    later: "Ahora no",
    repatch: "Cerrar y parchear",
    dirty: version => `Discord se ha actualizado a ${version} y ha perdido el parche, pero el repo tiene cambios sin commit. `
        + "Revísalos y ejecuta pnpm inject.",
    checkFailed: version => `Discord se ha actualizado a ${version} y el parche ya no encaja con su código. `
        + `Mira ${LOG} y adapta mod/ (AGENTS.md, «When Discord updates»).`,
    stillRunning: "Discord no se ha cerrado, así que no lo he vuelto a parchear. Ciérralo y ejecuta pnpm inject.",
    failed: step => `No se ha podido volver a parchear Discord: ha fallado pnpm ${step}. Mira ${LOG}; si dice EPERM, `
        + `activa «${HELPER_NAME}» en Ajustes → Privacidad y seguridad → Gestión de las apps.`,
    done: version => `Discord ${version} vuelve a estar parcheado.`,
    update: (current, latest, notes) => `Hay una versión nueva de agent-chat-bridge: ${latest.slice(1)} (tienes la `
        + `${current.slice(1)}).\n\n${notes}\n\n¿La instalo? Discord se cerrará y se volverá a abrir; si estás en una `
        + "llamada, se cortará.",
    install: "Instalar",
    updateFailed: (latest, current) => `No se ha podido instalar la versión ${latest.slice(1)}: ha fallado su instalación. `
        + `Sigues con la ${current.slice(1)}. Mira ${LOG}.`,
    crashed: `La comprobación del parche de Discord ha fallado. Mira ${LOG}.`
};

const quoted = text => JSON.stringify(text);

/** Runs a command; its output goes to the log, unless it is captured, and only then are stdout and stderr read. */
function exec(command, args, capture = false) {
    const result = spawnSync(command, args, { cwd: REPO, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
    if (result.error) throw result.error;
    return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

const notify = text => exec("osascript", ["-e", `display notification ${quoted(text)} with title ${quoted(APP_NAME)}`]);

/** Whether the user chose `yes`. «Ahora no», or a dialog that couldn't show, is a no. */
function ask(question, yes) {
    const answer = exec("osascript", ["-e", `display dialog ${quoted(question)} with title ${quoted(APP_NAME)}`
        + ` buttons {${quoted(TEXT.later)}, ${quoted(yes)}} default button ${quoted(yes)}`
        + ` cancel button ${quoted(TEXT.later)} with icon caution`], true);
    if (!answer.ok) console.log(`Declined: ${answer.stderr.trim()}`);
    return answer.ok;
}

/** Whether `value` is new to `file`, which then keeps it: what asks once per version. */
function firstSeen(file, value) {
    const seen = existsSync(file) && readFileSync(file, "utf8") === value;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, value);
    return !seen;
}

async function waitUntilQuit() {
    for (let waited = 0; discordRunning(); waited += POLL_MS) {
        if (waited >= QUIT_WAIT_MS) return false;
        await sleep(POLL_MS);
    }
    return true;
}

async function repatch() {
    // Only a running Discord: AppleScript would start a closed one in order to quit it.
    if (discordRunning()) exec("osascript", ["-e", 'quit app "Discord"']);
    if (!await waitUntilQuit()) {
        notify(TEXT.stillRunning);
        return;
    }
    exec("open", [HELPER]);
}

/** A command's captured output, or an error when it fails. */
function output(command, args) {
    const result = exec(command, args, true);
    if (!result.ok) throw new Error(`${command} failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
}

const appVersion = () => output("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", INFO_PLIST]);

/** What the helper runs, with its App Management permission: rebuild, patch, reopen Discord and say how it went. */
function apply() {
    const failed = ["build", "inject"].find(step => !exec("pnpm", [step]).ok);
    exec("open", ["-a", "Discord"]);
    notify(failed ? TEXT.failed(failed) : TEXT.done(appVersion()));
}

/** It asks only when a Discord version it hasn't seen comes unpatched. */
async function checkPatch() {
    if (!existsSync(ORIGINAL)) await sleep(SETTLE_MS);
    const version = appVersion();
    if (!firstSeen(SEEN, version) || existsSync(ORIGINAL)) return;
    console.log(`Discord ${version} lost the patch`);
    if (output("git", ["status", "--porcelain"])) notify(TEXT.dirty(version));
    else if (!exec("pnpm", ["check-discord"]).ok) notify(TEXT.checkFailed(version));
    else if (ask(TEXT.question(version), TEXT.repatch)) await repatch();
}

/** A release tag's x.y.z as numbers, or null for any other tag. */
function release(tag) {
    const parts = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
    return parts ?? null;
}

const newer = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The newest release tag on the remote, or null when it can't be listed (offline, say), which only the log notes. */
function latestRelease() {
    const listed = exec("git", ["ls-remote", "--tags", "--refs", "origin", "v*"], true);
    if (!listed.ok) {
        console.log(`Releases not checked: ${listed.stderr.trim()}`);
        return null;
    }
    // Stryker disable next-line StringLiteral: a line without a tag, as the last empty one, is no release either way.
    const tags = listed.stdout.split("\n").map(line => line.split("refs/tags/")[1] ?? "").filter(tag => release(tag));
    return tags.sort((a, b) => newer(/** @type {number[]} */ (release(b)), /** @type {number[]} */ (release(a))))[0] ?? null;
}

/** Offers a release newer than the clean release tag the clone is at, once; on a yes, installs it and reloads Discord. */
async function checkUpdate() {
    // Off a tag, git describe fails and prints nothing on stdout: no release.
    const current = exec("git", ["describe", "--tags", "--exact-match", "--match", "v*", "HEAD"], true).stdout.trim();
    // Only a clone installed at a release, as it was left: a development clone, or local changes, stay as they are.
    if (!release(current) || output("git", ["status", "--porcelain"])) return;
    const latest = latestRelease();
    if (!latest || newer(/** @type {number[]} */ (release(latest)), /** @type {number[]} */ (release(current))) <= 0) return;
    if (!firstSeen(RELEASE_SEEN, latest)) return;
    // The tag's objects only: nothing of it runs before the user's yes.
    output("git", ["fetch", "--no-tags", "origin", `refs/tags/${latest}:refs/tags/${latest}`]);
    const notes = plainNotes(output("git", ["tag", "--list", "--format=%(contents:body)", latest]));
    const shown = notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES)}…` : notes;
    if (!ask(TEXT.update(current, latest, shown), TEXT.install)) return;
    console.log(`Updating ${current} to ${latest}`);
    output("git", ["checkout", "--quiet", latest]);
    if (setUp()) {
        await repatch();
        return;
    }
    output("git", ["checkout", "--quiet", current]);
    setUp();
    notify(TEXT.updateFailed(latest, current));
}

/**
 * The release checked out installed and built. The install comes first: pnpm refuses to run a script while the
 * dependencies differ from the lockfile, as a new release's may.
 */
const setUp = () => exec("pnpm", ["install", "--frozen-lockfile"]).ok && exec("pnpm", ["bootstrap"]).ok;

/** A release's notes, from the changelog's Markdown to the plain text a dialog shows. */
function plainNotes(markdown) {
    return markdown
        .replaceAll("\n  ", " ") // a list item wrapped onto the next line joins it
        .replace(/^### (.+)/gm, "$1:") // `.` stops at the line's end
        .replace(/^- /gm, "• ")
        .replaceAll("`", "");
}

/** What the LaunchAgent runs: the patch after a Discord update, then a new release. */
async function run() {
    await checkPatch();
    await checkUpdate();
}

/** A shell word that stands for the text as it is. */
const shellWord = text => `'${text.replaceAll("'", "'\\''")}'`;

/** The script the helper runs: `apply`, with the tools on the PATH the install ran with, into the log. */
const applyScript = path => `cd ${shellWord(REPO)} && PATH=${shellWord(path)} exec node `
    + `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON ${shellWord(SELF)} apply >> ${shellWord(LOG)} 2>&1\n`;

/**
 * Builds the helper app, unless the one there already runs the same AppleScript: a new build, even of the same
 * source, loses the permission macOS granted to the old one. Returns whether it built one.
 */
function buildHelper() {
    const source = `do shell script ${quoted(`/bin/sh ${shellWord(APPLY)}`)}`;
    const compiled = join(HELPER, "Contents", "Resources", "Scripts", "main.scpt");
    if (existsSync(compiled) && output("osadecompile", [compiled]) === source) return false;
    rmSync(HELPER, { recursive: true, force: true });
    output("osacompile", ["-o", HELPER, "-e", source]);
    // Its executable and bundle name are what the App Management list shows.
    const info = join(HELPER, "Contents", "Info.plist");
    renameSync(join(HELPER, "Contents", "MacOS", "applet"), join(HELPER, "Contents", "MacOS", HELPER_NAME));
    for (const [key, value] of [["CFBundleExecutable", HELPER_NAME], ["CFBundleName", HELPER_NAME], ["CFBundleIdentifier", `${LABEL}.helper`]])
        output("plutil", ["-replace", key, "-string", value, info]);
    output("codesign", ["--force", "--sign", "-", HELPER]);
    return true;
}

/** The LaunchAgent: its tools on the PATH the install ran with, since launchd starts it with a bare one. */
function launchAgent(path) {
    const string = value => `<string>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</string>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>${string(LABEL)}
    <key>ProgramArguments</key>
    <array>${["/usr/bin/env", "node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SELF, "run"].map(string).join("")}</array>
    <key>WorkingDirectory</key>${string(REPO)}
    <key>EnvironmentVariables</key>
    <dict><key>PATH</key>${string(path)}</dict>
    <key>WatchPaths</key>
    <array>${string("/Applications")}${string(RESOURCES)}</array>
    <key>RunAtLoad</key><true/>
    <key>StartInterval</key><integer>${CHECK_INTERVAL_S}</integer>
    <key>StandardOutPath</key>${string(LOG)}
    <key>StandardErrorPath</key>${string(LOG)}
</dict>
</plist>
`;
}

const domain = () => `gui/${userInfo().uid}`;

function unload() {
    if (exec("launchctl", ["print", `${domain()}/${LABEL}`], true).ok && !exec("launchctl", ["bootout", domain(), PLIST]).ok)
        throw new Error(`launchctl couldn't unload ${LABEL}`);
}

function install() {
    const path = process.env.PATH ?? "";
    unload();
    mkdirSync(APP_FOLDER, { recursive: true });
    writeFileSync(APPLY, applyScript(path));
    const built = buildHelper();
    mkdirSync(dirname(PLIST), { recursive: true });
    writeFileSync(PLIST, launchAgent(path));
    if (!exec("launchctl", ["bootstrap", domain(), PLIST]).ok) throw new Error(`launchctl couldn't load ${PLIST}`);
    console.log(TEXT.installed);
    if (!built) return;
    exec("open", ["-R", HELPER]);
    exec("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles"]);
    console.log(TEXT.grant);
}

function uninstall() {
    unload();
    for (const file of [PLIST, HELPER, APPLY]) rmSync(file, { recursive: true, force: true });
    console.log(TEXT.uninstalled);
}

/** Runs what the user doesn't watch: a failure reaches them as a notification, and the log keeps the cause. */
async function unattended(task) {
    try {
        await task();
    } catch (err) {
        notify(TEXT.crashed);
        throw err;
    }
}

/** The command line: install, uninstall, run or apply. Exported for its test. */
export async function main(command = process.argv[2]) {
    if (command === "install") return install();
    if (command === "uninstall") return uninstall();
    if (command === "run") return unattended(run);
    if (command === "apply") return unattended(apply);
    console.error(TEXT.usage);
    process.exitCode = 2;
}

// Run as a command, not when test/ imports it.
// Stryker disable next-line all: only a run of the command reaches it, never the tests (and, for that, not the coverage).
/* v8 ignore next */ if (import.meta.main) await main();
