// Offers to re-patch Discord after an update replaces it (AGENTS.md, «When Discord updates»), and each new release.
// `install` schedules `run` on this system (scripts/os/: at login, when Discord changes where the system can watch it,
// and periodically); `uninstall` removes it. `run` patches nothing on its own: once per Discord version that lost the
// patch, it checks the new Discord with `check-discord` and, in a clone, a clean tree (the review of a re-patch
// without changes, AGENTS.md «Review»), then asks. Only on the user's yes does it quit Discord and run `apply`, with
// the rights patching needs on that system: it rebuilds mod/dist/ (in the release's executable, unpacks it), patches
// Discord and reopens it. In a clone those steps are pnpm's scripts, and in the executable its own commands.
// `run` also offers each new release once (README, «Update»). To the executable, from GitHub's releases: on a yes it
// downloads the system's executable, installs it only with a valid signature by the release key, and reloads Discord
// the same way. To a clone installed at a release tag, from its remote: on a yes it checks the new tag out and sets it
// up. A development clone is never touched.
import { verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { executableName, INSTALLED, STATE, unpack, UV, VERSION } from "./bundle.mjs";
import { discordRunning, discordVersion, original, resources } from "./discord-app.mjs";
import { exec, output } from "./os/exec.mjs";
import { system } from "./os/index.mjs";
import { download, latestRelease } from "./release-feed.mjs";
import { RELEASE_KEY } from "./release-key.mjs";
import { setUpDictation } from "./setup-dictation.mjs";

const LOG = system.logFile(STATE);
/**
 * The last Discord version this script saw, patched or not: it asks once per version, and a patch removed by hand
 * (`pnpm uninject`) keeps the version, so it asks nothing.
 */
const SEEN = join(STATE, "repatch-seen-version");
/** The last release offered: it offers each one once. */
const RELEASE_SEEN = join(STATE, "update-seen-release");

/** An update rewrites the app for a while: the check waits for it to settle. */
const SETTLE_MS = 30_000;
/** How long Discord gets to quit before the re-patch gives up. */
const QUIT_WAIT_MS = 30_000;
const POLL_MS = 1_000;
/** A release's notes in the dialog, cut to what a dialog shows. */
const MAX_NOTES = 800;

/** The command that runs a step by hand, as the user types it: the executable's, or the clone's pnpm script. */
const CLI = INSTALLED ? "agent-chat-bridge" : "pnpm";

/** What the user reads, in a dialog or a notification. */
const TEXT = {
    usage: INSTALLED ? "Uso: agent-chat-bridge repatch install|uninstall|run|apply" : "Uso: node scripts/repatch.mjs install|uninstall|run|apply",
    installed: "Instalado: al actualizarse Discord, se te preguntará si volver a parchearlo, y al salir una versión nueva "
        + `de agent-chat-bridge, si instalarla. El registro está en ${LOG}.`,
    uninstalled: "Desinstalado: Discord ya no se vuelve a parchear tras actualizarse.",
    question: version => `Discord se ha actualizado a ${version} y ha perdido el parche de agent-chat-bridge. `
        + `${CLI} check-discord da por bueno el parche con el código nuevo. `
        + "¿Lo vuelvo a parchear? Discord se cerrará y se volverá a abrir; si estás en una llamada, se cortará. "
        + `Si no, ejecuta ${CLI} inject cuando quieras.`,
    later: "Ahora no",
    repatch: "Cerrar y parchear",
    dirty: version => `Discord se ha actualizado a ${version} y ha perdido el parche, pero el repo tiene cambios sin commit. `
        + "Revísalos y ejecuta pnpm inject.",
    checkFailed: version => `Discord se ha actualizado a ${version} y el parche ya no encaja con su código. `
        + (INSTALLED
            ? "Discord funciona sin los plugins hasta que una versión nueva de agent-chat-bridge lo adapte, que se te "
                + `ofrecerá aquí. Mira ${LOG}.`
            : `Mira ${LOG} y adapta mod/ (AGENTS.md, «When Discord updates»).`),
    stillRunning: `Discord no se ha cerrado, así que no lo he vuelto a parchear. Ciérralo y ejecuta ${CLI} inject.`,
    failed: step => [`No se ha podido volver a parchear Discord: ha fallado ${CLI} ${step}. Mira ${LOG}.`, system.permissionHint]
        .filter(Boolean).join(" "),
    done: version => `Discord ${version} vuelve a estar parcheado.`,
    update: (current, latest, notes) => `Hay una versión nueva de agent-chat-bridge: ${latest.slice(1)} (tienes la `
        + `${current.slice(1)}).\n\n${notes}\n\n¿La instalo? Discord se cerrará y se volverá a abrir; si estás en una `
        + "llamada, se cortará.",
    install: "Instalar",
    updateFailed: (latest, current) => `No se ha podido instalar la versión ${latest.slice(1)}: ha fallado su instalación. `
        + `Sigues con la ${current.slice(1)}. Mira ${LOG}.`,
    unsigned: (latest, current) => `La versión ${latest.slice(1)} de agent-chat-bridge no lleva una firma válida, así que `
        + `no la he instalado. Sigues con la ${current.slice(1)}.`,
    crashed: `La comprobación del parche de Discord ha fallado. Mira ${LOG}.`
};

/** Runs pnpm the way this system runs it. */
const pnpm = (/** @type {string[]} */ args) => exec(...system.pnpm(args));
/** Runs a step that both have: the clone's pnpm script, or the executable's command of the same name. */
const step = (/** @type {string} */ name) => INSTALLED ? exec(process.execPath, [name]) : pnpm([name]);

/** Whether the user chose `yes`. «Ahora no», or a dialog that couldn't show, is a no, and the log says which. */
function ask(question, yes) {
    const answer = system.ask(question, yes, TEXT.later);
    if (!answer.ok) console.log(`Declined: ${answer.reason}`);
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

/**
 * What the check and the scheduler need to know of this install: `command` runs this script's commands, as the
 * executable's `repatch` or as the clone's script on the Node of the PATH. The executable's `apply` runs the one on
 * disk, which after an update is the new one, with the files it carries.
 */
const agent = () => ({
    state: STATE,
    command: INSTALLED ? [process.execPath, "repatch"] : ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", fileURLToPath(import.meta.url)],
    path: process.env.PATH ?? "",
    log: LOG,
    apply: INSTALLED ? () => void exec(process.execPath, ["repatch", "apply"]) : apply
});

async function repatch() {
    if (discordRunning()) system.quit();
    if (!await waitUntilQuit()) {
        system.notify(TEXT.stillRunning);
        return;
    }
    system.runApply(agent());
}

/**
 * The files the patch loads, made anew: built in a clone, unpacked from the executable, with Dictation's packages
 * installed again where they were, as a new release's uv.lock may pin others.
 */
function refresh() {
    if (!INSTALLED) return pnpm(["build"]).ok;
    unpack();
    const worker = join(STATE, "dictation", "worker");
    return !existsSync(join(worker, ".venv")) || setUpDictation(UV, worker, false) === 0;
}

/** Refresh, patch, reopen Discord and say how it went; on macOS the helper app runs it, with its permission. */
function apply() {
    const failed = !refresh() ? (INSTALLED ? "install --dictation" : "build") : !step("inject").ok ? "inject" : null;
    system.open();
    system.notify(failed ? TEXT.failed(failed) : TEXT.done(discordVersion()));
}

/** It asks only when a Discord version it hasn't seen comes unpatched. */
async function checkPatch() {
    if (!system.resources()) {
        console.log("Discord is not installed");
        return;
    }
    if (!existsSync(original())) await sleep(SETTLE_MS);
    const version = discordVersion();
    if (!firstSeen(SEEN, version) || existsSync(original())) return;
    console.log(`Discord ${version} lost the patch`);
    // The executable's files are the release's as it was signed: only a clone can have changes of its own.
    if (!INSTALLED && output("git", ["status", "--porcelain"])) system.notify(TEXT.dirty(version));
    else if (!step("check-discord").ok) system.notify(TEXT.checkFailed(version));
    else if (ask(TEXT.question(version), TEXT.repatch)) await repatch();
}

/** A release tag's x.y.z as numbers, or null for any other tag. */
function release(tag) {
    const parts = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
    return parts ?? null;
}

const newer = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The newest release tag on the remote, or null when it can't be listed (offline, say), which only the log notes. */
function latestTag() {
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
    if (INSTALLED) return checkRelease();
    // Off a tag, git describe fails and prints nothing on stdout: no release.
    const current = exec("git", ["describe", "--tags", "--exact-match", "--match", "v*", "HEAD"], true).stdout.trim();
    // Only a clone installed at a release, as it was left: a development clone, or local changes, stay as they are.
    if (!release(current) || output("git", ["status", "--porcelain"])) return;
    const latest = latestTag();
    if (!latest || newer(/** @type {number[]} */ (release(latest)), /** @type {number[]} */ (release(current))) <= 0) return;
    if (!firstSeen(RELEASE_SEEN, latest)) return;
    // The tag's objects only: nothing of it runs before the user's yes.
    output("git", ["fetch", "--no-tags", "origin", `refs/tags/${latest}:refs/tags/${latest}`]);
    const notes = output("git", ["tag", "--list", "--format=%(contents:body)", latest]);
    if (!ask(TEXT.update(current, latest, shownNotes(notes)), TEXT.install)) return;
    console.log(`Updating ${current} to ${latest}`);
    output("git", ["checkout", "--quiet", latest]);
    if (setUp()) {
        await repatch();
        return;
    }
    output("git", ["checkout", "--quiet", current]);
    setUp();
    system.notify(TEXT.updateFailed(latest, current));
}

/**
 * The release checked out installed and built. The install comes first: pnpm refuses to run a script while the
 * dependencies differ from the lockfile, as a new release's may.
 */
const setUp = () => pnpm(["install", "--frozen-lockfile"]).ok && pnpm(["bootstrap"]).ok;

/** A release's notes, from the changelog's Markdown to the plain text a dialog shows, cut to what it fits. */
function shownNotes(markdown) {
    const notes = markdown
        .replaceAll("\n  ", " ") // a list item wrapped onto the next line joins it
        .replace(/^### (.+)/gm, "$1:") // `.` stops at the line's end
        .replace(/^- /gm, "• ")
        .replaceAll("`", "");
    return notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES)}…` : notes;
}

/**
 * Offers a release newer than this executable, once, if it has this system's executable; on a yes, downloads it and
 * its signature, swaps it in only if the release key signed it, and reloads Discord, which `apply` of the new one does.
 */
async function checkRelease() {
    // Windows keeps the executable that ran the last update until it ends: it goes now.
    rmSync(`${process.execPath}.old`, { force: true });
    const current = `v${VERSION}`;
    const latest = await latestRelease();
    const tag = latest && release(latest.tag);
    if (!latest || !tag || newer(tag, /** @type {number[]} */ (release(current))) <= 0) return;
    const name = executableName(process.platform, process.arch);
    const [url, signatureUrl] = [latest.files[name], latest.files[`${name}.sig`]];
    if (!url || !signatureUrl) {
        console.log(`${latest.tag} has no ${name} and its signature`);
        return;
    }
    if (!firstSeen(RELEASE_SEEN, latest.tag)) return;
    if (!ask(TEXT.update(current, latest.tag, shownNotes(latest.notes)), TEXT.install)) return;
    console.log(`Updating ${current} to ${latest.tag}`);
    const [executable, signature] = await Promise.all([download(url), download(signatureUrl)]);
    if (!verify(null, executable, RELEASE_KEY, signature)) {
        system.notify(TEXT.unsigned(latest.tag, current));
        return;
    }
    replaceExecutable(executable);
    await repatch();
}

/** Puts the new executable where this one is: elsewhere a rename replaces it at once; Windows lets a running one be renamed, not replaced. */
function replaceExecutable(executable) {
    const path = process.execPath;
    writeFileSync(`${path}.new`, executable, { mode: 0o755 });
    if (process.platform === "win32") renameSync(path, `${path}.old`);
    renameSync(`${path}.new`, path);
}

/** What the scheduler runs: the patch after a Discord update, then a new release. */
async function run() {
    await checkPatch();
    await checkUpdate();
}

function install() {
    resources(); // the check watches an installed Discord: none fails here, saying so
    mkdirSync(STATE, { recursive: true });
    const steps = system.installAgent(agent());
    for (const text of [TEXT.installed, ...steps]) console.log(text);
}

function uninstall() {
    for (const text of [TEXT.uninstalled, ...system.uninstallAgent(agent())]) console.log(text);
}

/** Runs what the user doesn't watch: a failure reaches them as a notification, and the log keeps the cause. */
async function unattended(task) {
    try {
        await task();
    } catch (err) {
        system.notify(TEXT.crashed);
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
// Not awaited, so a bundler can take this module into the executable's script, which has no top-level await: a
// failure still ends the run with its error and exit code 1, as an unhandled rejection does.
/* v8 ignore next */ if (import.meta.main) main();
