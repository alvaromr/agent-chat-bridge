// The re-patch after a Discord update (scripts/repatch.mjs) and the shared check of a running Discord
// (scripts/discord-app.mjs), with the machine faked: the commands it runs and what each answers, the clock, and a
// temporary HOME. Run with `pnpm test`.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, test, vi } from "vitest";

const REPO = fileURLToPath(new URL("..", import.meta.url));

/** The machine: Discord's state, what each command answers, and every command run, in order. @type {any} */
const machine = vi.hoisted(() => ({}));
const fresh = () => ({
    home: "", patched: false, running: true, quits: true, version: "0.0.422", plutil: true, dirty: "", check: true,
    answer: true, build: true, inject: true, loaded: false, bootout: true, bootstrap: true, missing: "", pgrepStatus: 1,
    onSleep: () => { }, runs: [], piped: [], sleeps: [], cwds: new Set()
});

vi.mock("node:os", async original => ({ ...(/** @type {any} */ (await original())), homedir: () => machine.home, userInfo: () => ({ uid: 501 }) }));
vi.mock("node:fs", async original => {
    const fs = /** @type {any} */ (await original());
    return { ...fs, existsSync: path => path === "/Applications/Discord.app/Contents/Resources/_app.asar" ? machine.patched : fs.existsSync(path) };
});
vi.mock("node:timers/promises", () => ({
    setTimeout: async ms => {
        machine.sleeps.push(ms);
        machine.onSleep();
    }
}));
vi.mock("node:child_process", () => ({
    execFileSync: (command, args, options) => {
        assert.deepEqual([command, args, options], ["pgrep", ["-x", "Discord"], { stdio: "ignore" }]);
        machine.runs.push(command);
        if (!machine.running) throw Object.assign(new Error("pgrep"), { status: machine.pgrepStatus });
    },
    spawnSync: (command, args, options) => {
        machine.runs.push([command, ...args].join(" "));
        machine.cwds.add(options.cwd);
        if (options.stdio === "pipe") machine.piped.push(command);
        if (command === machine.missing) return { error: new Error(`spawnSync ${command} ENOENT`), status: null };
        const answer = (ok, stdout = "", stderr = "") => ({ status: ok ? 0 : 1, stdout: options.stdio === "pipe" ? stdout : null, stderr: options.stdio === "pipe" ? stderr : null });
        const line = args.join(" ");
        if (command === "plutil") return answer(machine.plutil, `${machine.version}\n`, "no such file\n");
        if (command === "git") return answer(true, machine.dirty);
        if (command === "pnpm") return answer({ "check-discord": machine.check, build: machine.build, inject: machine.inject }[line]);
        if (command === "launchctl" && args[0] === "print") return answer(machine.loaded);
        if (command === "launchctl") return answer(args[0] === "bootout" ? machine.bootout : machine.bootstrap);
        if (line.includes("display dialog")) return answer(machine.answer, "button returned:Cerrar y parchear\n", "execution error: User canceled. (-128)\n");
        if (line.includes("quit app")) machine.running = !machine.quits;
        return answer(true);
    }
}));

let logged, errors;
beforeEach(() => {
    Object.assign(machine, fresh(), { home: mkdtempSync(join(tmpdir(), "repatch-")) });
    logged = vi.spyOn(console, "log").mockImplementation(() => { });
    errors = vi.spyOn(console, "error").mockImplementation(() => { });
    process.exitCode = undefined;
    vi.resetModules();
});
afterEach(() => {
    rmSync(machine.home, { recursive: true, force: true });
    process.exitCode = undefined;
});

const main = async command => (await import("../scripts/repatch.mjs")).main(command);
const SEEN = () => join(machine.home, "Library", "Application Support", "agent-chat-bridge", "repatch-seen-version");
const PLIST = () => join(machine.home, "Library", "LaunchAgents", "local.agent-chat-bridge.repatch.plist");
const LOG = () => join(machine.home, "Library", "Logs", "agent-chat-bridge-repatch.log");
const notification = text => `osascript -e display notification ${JSON.stringify(text)} with title "agent-chat-bridge"`;
const VERSION = "plutil -extract CFBundleShortVersionString raw -o - /Applications/Discord.app/Contents/Info.plist";
const QUESTION = "Discord se ha actualizado a 0.0.422 y ha perdido el parche de agent-chat-bridge. "
    + "pnpm check-discord da por bueno el parche con el código nuevo. "
    + "¿Lo vuelvo a parchear? Discord se cerrará y se volverá a abrir; si estás en una llamada, se cortará. "
    + "Si no, ejecuta pnpm inject cuando quieras.";
const DIALOG = `osascript -e display dialog ${JSON.stringify(QUESTION)} with title "agent-chat-bridge"`
    + ' buttons {"Ahora no", "Cerrar y parchear"} default button "Cerrar y parchear" cancel button "Ahora no" with icon caution';
/** What a run does up to the question, on an unpatched Discord it hasn't seen. */
const UP_TO_QUESTION = [VERSION, "git status --porcelain", "pnpm check-discord", DIALOG];

test("discord-app: the patch's files sit in Discord's Resources", async () => {
    assert.deepEqual({ ...await import("../scripts/discord-app.mjs") }, {
        RESOURCES: "/Applications/Discord.app/Contents/Resources",
        ASAR: "/Applications/Discord.app/Contents/Resources/app.asar",
        ORIGINAL: "/Applications/Discord.app/Contents/Resources/_app.asar",
        discordRunning: (await import("../scripts/discord-app.mjs")).discordRunning
    });
});

test("repatch: on a patched Discord it only notes the version, at once, and asks nothing", async () => {
    machine.patched = true;
    await main("run");
    assert.deepEqual(machine.runs, [VERSION]);
    assert.deepEqual(machine.sleeps, []);
    assert.equal(readFileSync(SEEN(), "utf8"), "0.0.422");
});

test("repatch: an update that lost the patch waits for the app to settle, checks it, asks, and on yes quits, rebuilds, patches and reopens Discord", async () => {
    await main("run");
    assert.deepEqual(machine.runs, [
        ...UP_TO_QUESTION, "pgrep", 'osascript -e quit app "Discord"', "pgrep",
        "pnpm build", "pnpm inject", "open -a Discord", notification("Discord 0.0.422 vuelve a estar parcheado.")
    ]);
    assert.deepEqual(machine.sleeps, [30_000]);
    assert.deepEqual([...machine.cwds], [REPO]);
    // Only what the script reads is captured; the rest, pnpm's output included, goes to the log.
    assert.deepEqual(machine.piped, ["plutil", "git", "osascript"]);
    assert.equal(readFileSync(SEEN(), "utf8"), "0.0.422");
    assert.deepEqual(logged.mock.calls, [["Discord 0.0.422 lost the patch"]]);
});

test("repatch: with Discord closed it patches without quitting it, and opens it", async () => {
    machine.running = false;
    await main("run");
    assert.deepEqual(machine.runs.slice(UP_TO_QUESTION.length), [
        "pgrep", "pgrep", "pnpm build", "pnpm inject", "open -a Discord", notification("Discord 0.0.422 vuelve a estar parcheado.")
    ]);
});

test("repatch: on «Ahora no», or a dialog that can't show, it touches nothing and logs why", async () => {
    machine.answer = false;
    await main("run");
    assert.deepEqual(machine.runs, UP_TO_QUESTION);
    assert.deepEqual(logged.mock.calls.at(-1), ["Not re-patched: execution error: User canceled. (-128)"]);
});

test("repatch: a version already seen asks nothing again, so a declined one or a patch removed by hand stays quiet", async () => {
    machine.answer = false;
    await main("run");
    machine.runs = [];
    vi.resetModules();
    await main("run");
    assert.deepEqual(machine.runs, [VERSION]);
});

test("repatch: a new version after a seen one asks again", async () => {
    await main("run");
    Object.assign(machine, { version: "0.0.423", runs: [] });
    vi.resetModules();
    await main("run");
    assert.equal(machine.runs.length > 1, true);
    assert.equal(readFileSync(SEEN(), "utf8"), "0.0.423");
});

test("repatch: a Discord patched while the update settles asks nothing", async () => {
    machine.onSleep = () => void (machine.patched = true);
    await main("run");
    assert.deepEqual(machine.runs, [VERSION]);
});

test("repatch: with uncommitted changes it doesn't check or ask, and says to review them", async () => {
    machine.dirty = " M mod/src/main.ts\n";
    await main("run");
    assert.deepEqual(machine.runs, [VERSION, "git status --porcelain", notification(
        "Discord se ha actualizado a 0.0.422 y ha perdido el parche, pero el repo tiene cambios sin commit. Revísalos y ejecuta pnpm inject.")]);
});

test("repatch: when pnpm check-discord fails it doesn't ask, and says where to look", async () => {
    machine.check = false;
    await main("run");
    assert.deepEqual(machine.runs.slice(3), [notification("Discord se ha actualizado a 0.0.422 y el parche ya no encaja con su código. "
        + `Mira ${LOG()} y adapta mod/ (AGENTS.md, «When Discord updates»).`)]);
});

test("repatch: a Discord that doesn't quit in 30 s is left unpatched, with a notification", async () => {
    machine.quits = false;
    await main("run");
    const after = machine.runs.slice(UP_TO_QUESTION.length);
    assert.deepEqual(after.at(-1), notification("Discord no se ha cerrado, así que no lo he vuelto a parchear. Ciérralo y ejecuta pnpm inject."));
    assert.equal(after.filter(run => run === "pgrep").length, 32);
    assert.deepEqual(machine.sleeps, [30_000, ...Array(30).fill(1_000)]);
});

test("repatch: a failed build patches nothing, a failed patch says so, and Discord reopens either way", async () => {
    /** @type {[string, string[]][]} */
    const steps = [["build", ["pnpm build"]], ["inject", ["pnpm build", "pnpm inject"]]];
    for (const [step, expected] of steps) {
        Object.assign(machine, fresh(), { home: machine.home, [step]: false });
        rmSync(SEEN(), { force: true });
        vi.resetModules();
        await main("run");
        assert.deepEqual(machine.runs.slice(UP_TO_QUESTION.length + 3), [
            ...expected, "open -a Discord", notification(`No se ha podido volver a parchear Discord: ha fallado pnpm ${step}. Mira ${LOG()}.`)
        ], step);
    }
});

test("repatch: a run that fails tells the user with a notification and fails with the cause", async () => {
    machine.plutil = false;
    await assert.rejects(main("run"), { message: "plutil failed: no such file" });
    assert.deepEqual(machine.runs.at(-1), notification(`La comprobación del parche de Discord ha fallado. Mira ${LOG()}.`));
    assert.equal(existsSync(SEEN()), false);
});

test("repatch: a command that isn't installed fails the run", async () => {
    machine.missing = "git";
    await assert.rejects(main("run"), { message: "spawnSync git ENOENT" });
});

test("repatch: a pgrep that fails for another reason than finding no Discord fails the run", async () => {
    Object.assign(machine, { running: false, pgrepStatus: 2 });
    await assert.rejects(main("run"), { message: "pgrep" });
    machine.pgrepStatus = undefined;
    vi.resetModules();
    rmSync(SEEN(), { force: true });
    await assert.rejects(main("run"), { message: "pgrep" });
});

test("repatch: install writes the LaunchAgent and loads it, replacing a loaded one", async () => {
    for (const loaded of [false, true]) {
        Object.assign(machine, { loaded, runs: [] });
        vi.resetModules();
        await main("install");
        assert.deepEqual(machine.runs, [
            "launchctl print gui/501/local.agent-chat-bridge.repatch",
            ...loaded ? [`launchctl bootout gui/501 ${PLIST()}`] : [],
            `launchctl bootstrap gui/501 ${PLIST()}`
        ]);
    }
    assert.deepEqual(machine.piped, ["launchctl", "launchctl"]);
    const plist = readFileSync(PLIST(), "utf8");
    const path = (process.env.PATH ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;");
    assert.equal(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>local.agent-chat-bridge.repatch</string>
    <key>ProgramArguments</key>
    <array><string>${process.execPath}</string><string>--disable-warning=MODULE_TYPELESS_PACKAGE_JSON</string><string>${REPO}scripts/repatch.mjs</string><string>run</string></array>
    <key>WorkingDirectory</key><string>${REPO}</string>
    <key>EnvironmentVariables</key>
    <dict><key>PATH</key><string>${path}</string></dict>
    <key>WatchPaths</key>
    <array><string>/Applications</string><string>/Applications/Discord.app/Contents/Resources</string></array>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>${LOG()}</string>
    <key>StandardErrorPath</key><string>${LOG()}</string>
</dict>
</plist>
`);
    assert.deepEqual(logged.mock.calls.at(-1), [`Instalado: al actualizarse Discord, se te preguntará si volver a parchearlo. El registro está en ${LOG()}.`]);
});

test("repatch: the LaunchAgent escapes what XML would read as markup, and an unset PATH stays empty", async () => {
    const saved = process.env.PATH;
    try {
        process.env.PATH = "/a&b<c:/usr/bin";
        await main("install");
        assert.match(readFileSync(PLIST(), "utf8"), /<string>\/a&amp;b&lt;c:\/usr\/bin<\/string>/);
        delete process.env.PATH;
        vi.resetModules();
        await main("install");
        assert.match(readFileSync(PLIST(), "utf8"), /<key>PATH<\/key><string><\/string>/);
    } finally {
        process.env.PATH = saved;
    }
});

test("repatch: install fails when launchctl can't load the agent or unload the old one", async () => {
    machine.bootstrap = false;
    await assert.rejects(main("install"), { message: `launchctl couldn't load ${PLIST()}` });
    Object.assign(machine, { bootstrap: true, loaded: true, bootout: false });
    vi.resetModules();
    await assert.rejects(main("install"), { message: "launchctl couldn't unload local.agent-chat-bridge.repatch" });
});

test("repatch: uninstall unloads a loaded agent and removes it", async () => {
    await main("install");
    for (const loaded of [true, false]) {
        Object.assign(machine, { loaded, runs: [] });
        vi.resetModules();
        await main("uninstall");
        assert.deepEqual(machine.runs, [
            "launchctl print gui/501/local.agent-chat-bridge.repatch", ...loaded ? [`launchctl bootout gui/501 ${PLIST()}`] : []
        ]);
        assert.equal(existsSync(PLIST()), false);
    }
    assert.deepEqual(logged.mock.calls.at(-1), ["Desinstalado: Discord ya no se vuelve a parchear tras actualizarse."]);
});

test("repatch: any other command prints the usage and fails", async () => {
    for (const command of [undefined, "inject"]) {
        await main(command);
        assert.equal(process.exitCode, 2);
    }
    assert.deepEqual(errors.mock.calls, Array(2).fill(["Uso: node scripts/repatch.mjs install|uninstall|run"]));
    assert.deepEqual(machine.runs, []);
});
