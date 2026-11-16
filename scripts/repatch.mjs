// Offers to re-patch Discord after an update replaces it (AGENTS.md, «When Discord updates»). `install` adds a
// LaunchAgent that runs `run` at login and whenever /Applications or Discord's Resources change; `uninstall` removes it.
// `run` patches nothing on its own: once per Discord version that lost the patch, it checks the new Discord with
// `pnpm check-discord` and a clean tree (the review of a re-patch without changes, AGENTS.md «Review»), then asks.
// Only on the user's yes does it quit Discord, rebuild mod/dist/, patch it and reopen it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const LOG =join(homedir(), "Library", "Logs", `${APP_NAME}-repatch.log`);
/**
 * The last Discord version this script saw, patched or not: it asks once per version, and a patch removed by hand
 * (`pnpm uninject`) keeps the version, so it asks nothing.
 */
const SEEN = join(homedir(), "Library", "Application Support", APP_NAME, "repatch-seen-version");
const INFO_PLIST = join(dirname(RESOURCES), "Info.plist");

/** An update rewrites the app for a while: the check waits for it to settle. */
const SETTLE_MS = 30_000;
/** How long Discord gets to quit before the re-patch gives up. */
const QUIT_WAIT_MS = 30_000;
const POLL_MS = 1_000;

/** What the user reads, in a dialog or a notification. */
const TEXT = {
    usage: "Uso: node scripts/repatch.mjs install|uninstall|run",
    installed: `Instalado: al actualizarse Discord, se te preguntará si volver a parchearlo. El registro está en ${LOG}.`,
    uninstalled: "Desinstalado: Discord ya no se vuelve a parchear tras actualizarse.",
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
    failed: step => `No se ha podido volver a parchear Discord: ha fallado pnpm ${step}. Mira ${LOG}.`,
    done: version => `Discord ${version} vuelve a estar parcheado.`,
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

/** Whether the user chose to re-patch now. Any other answer, or a dialog that couldn't show, is a no. */
function askToRepatch(version) {
    const answer = exec("osascript", ["-e", `display dialog ${quoted(TEXT.question(version))} with title ${quoted(APP_NAME)}`
        + ` buttons {${quoted(TEXT.later)}, ${quoted(TEXT.repatch)}} default button ${quoted(TEXT.repatch)}`
        + ` cancel button ${quoted(TEXT.later)} with icon caution`], true);
    if (!answer.ok) console.log(`Not re-patched: ${answer.stderr.trim()}`);
    return answer.ok;
}

async function waitUntilQuit() {
    for (let waited = 0; discordRunning(); waited += POLL_MS) {
        if (waited >= QUIT_WAIT_MS) return false;
        await sleep(POLL_MS);
    }
    return true;
}

async function repatch(version) {
    // Only a running Discord: AppleScript would start a closed one in order to quit it.
    if (discordRunning()) exec("osascript", ["-e", 'quit app "Discord"']);
    if (!await waitUntilQuit()) {
        notify(TEXT.stillRunning);
        return;
    }
    const failed = ["build", "inject"].find(step => !exec("pnpm", [step]).ok);
    exec("open", ["-a", "Discord"]);
    notify(failed ? TEXT.failed(failed) : TEXT.done(version));
}

/** A command's captured output, or an error when it fails. */
function output(command, args) {
    const result = exec(command, args, true);
    if (!result.ok) throw new Error(`${command} failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
}

/** What the LaunchAgent runs: it asks only when a Discord version it hasn't seen comes unpatched. */
async function run() {
    if (!existsSync(ORIGINAL)) await sleep(SETTLE_MS);
    const version = output("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", INFO_PLIST]);
    const seen = existsSync(SEEN) && readFileSync(SEEN, "utf8") === version;
    mkdirSync(dirname(SEEN), { recursive: true });
    writeFileSync(SEEN, version);
    if (existsSync(ORIGINAL) || seen) return;
    console.log(`Discord ${version} lost the patch`);
    if (output("git", ["status", "--porcelain"])) notify(TEXT.dirty(version));
    else if (!exec("pnpm", ["check-discord"]).ok) notify(TEXT.checkFailed(version));
    else if (askToRepatch(version)) await repatch(version);
}

/** The LaunchAgent: its tools on the PATH the install ran with, since launchd starts it with a bare one. */
function launchAgent(node, path) {
    const string = value => `<string>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</string>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>${string(LABEL)}
    <key>ProgramArguments</key>
    <array>${[node, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SELF, "run"].map(string).join("")}</array>
    <key>WorkingDirectory</key>${string(REPO)}
    <key>EnvironmentVariables</key>
    <dict><key>PATH</key>${string(path)}</dict>
    <key>WatchPaths</key>
    <array>${string("/Applications")}${string(RESOURCES)}</array>
    <key>RunAtLoad</key><true/>
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
    unload();
    mkdirSync(dirname(PLIST), { recursive: true });
    writeFileSync(PLIST, launchAgent(process.execPath, process.env.PATH ?? ""));
    if (!exec("launchctl", ["bootstrap", domain(), PLIST]).ok) throw new Error(`launchctl couldn't load ${PLIST}`);
    console.log(TEXT.installed);
}

function uninstall() {
    unload();
    rmSync(PLIST, { force: true });
    console.log(TEXT.uninstalled);
}

/** The command line: install, uninstall or run. Exported for its test. */
export async function main(command = process.argv[2]) {
    if (command === "install") return install();
    if (command === "uninstall") return uninstall();
    if (command === "run") {
        try {
            return await run();
        } catch (err) {
            // launchd only logs it: the notification is what the user sees.
            notify(TEXT.crashed);
            throw err;
        }
    }
    console.error(TEXT.usage);
    process.exitCode = 2;
}

// Run as a command, not when test/ imports it.
// Stryker disable next-line all: only a run of the command reaches it, never the tests (and, for that, not the coverage).
/* v8 ignore next */ if (import.meta.main) await main();
