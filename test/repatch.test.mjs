// The re-patch after a Discord update (scripts/repatch.mjs) and the shared check of a running Discord
// (scripts/discord-app.mjs), with the machine faked: the commands it runs and what each answers, the clock, and a
// temporary HOME. Run with `pnpm test`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeEach, test, vi } from "vitest";

const REPO = fileURLToPath(new URL("..", import.meta.url));

/**
 * The machine: Discord's state, what each command answers, and every command run, in order. It is a Mac on every
 * system the suite runs on, with its paths, so scripts/os/index.mjs picks the macOS module; the others are tested on
 * their own fakes in test/os.test.mjs.
 */
const { machine, platform } = vi.hoisted(() => {
    const platform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    return { machine: /** @type {any} */ ({}), platform };
});
afterAll(() => void Object.defineProperty(process, "platform", { value: platform }));
vi.mock("node:path", async original => (await import("../dictation/test/posix-path.mjs")).posixPath(original));
const fresh = () => ({
    home: "", installed: true, patched: false, running: true, quits: true, version: "0.0.422", dirty: "", check: true,
    answer: true, build: true, inject: true, install: true, setup: true, at: "", remote: [], notes: "", loaded: false, bootout: true, bootstrap: true, missing: "", pgrepStatus: 1, pgrepMissing: "",
    onSleep: () => { }, runs: [], piped: [], sleeps: [], cwds: new Set(), release: null, files: {}, downloads: [], sync: 0
});

vi.mock("node:os", async original => ({ ...(/** @type {any} */ (await original())), homedir: () => machine.home, userInfo: () => ({ uid: 501 }) }));
/** GitHub's releases, for the executable: the latest one, and the files it downloads by URL. */
vi.mock("../scripts/release-feed.mjs", () => ({
    latestRelease: async () => machine.release,
    download: async url => {
        machine.downloads.push(url);
        return machine.files[url];
    }
}));
/** Dictation's packages, which the executable's apply installs again where they were. */
vi.mock("../scripts/setup-dictation.mjs", () => ({
    setUpDictation: (uv, project, dev) => {
        machine.runs.push(`setUpDictation ${uv} ${project} ${dev}`);
        return machine.sync;
    }
}));
/** A release key of the test's own, whose private half signs the fake releases. */
vi.mock("../scripts/release-key.mjs", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    machine.keys ??= generateKeyPairSync("ed25519");
    return { RELEASE_KEY: machine.keys.publicKey };
});
/** The installed Discord: its folder, whether it is patched, and the version its build_info.json says. */
vi.mock("node:fs", async original => {
    const fs = /** @type {any} */ (await original());
    const resources = "/Applications/Discord.app/Contents/Resources";
    return {
        ...fs,
        existsSync: path => path === resources ? machine.installed : path === `${resources}/_app.asar` ? machine.patched : fs.existsSync(path),
        readFileSync: (path, encoding) => path === `${resources}/build_info.json`
            ? machine.version ? JSON.stringify({ releaseChannel: "stable", version: machine.version }) : fs.readFileSync(`${machine.home}/none`, encoding)
            : fs.readFileSync(path, encoding)
    };
});
vi.mock("node:timers/promises", () => ({
    setTimeout: async ms => {
        machine.sleeps.push(ms);
        machine.onSleep();
    }
}));
vi.mock("node:child_process", async () => {
    const fs = /** @type {typeof import("node:fs")} */ (await vi.importActual("node:fs"));
    /** What osacompile leaves: the applet under its default name, its Info.plist and the compiled source. */
    const compile = (app, source) => {
        fs.mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
        fs.mkdirSync(join(app, "Contents", "Resources", "Scripts"), { recursive: true });
        fs.writeFileSync(join(app, "Contents", "MacOS", "applet"), "");
        fs.writeFileSync(join(app, "Contents", "Info.plist"), "");
        fs.writeFileSync(join(app, "Contents", "Resources", "Scripts", "main.scpt"), source);
    };
    /** The clone: the tag it is at, the remote's tags, the notes of a fetched tag, and the checkouts made. */
    const git = (args, answer) => {
        if (args[0] === "status") return answer(true, machine.dirty);
        if (args[0] === "describe") return answer(Boolean(machine.at), `${machine.at}\n`, "fatal: no tag exactly matches\n");
        if (args[0] === "ls-remote") return answer(machine.remote !== null, (machine.remote ?? []).map(tag => `0123abc\trefs/tags/${tag}\n`).join(""), "fatal: unable to access\n");
        if (args[0] === "tag") return answer(true, `${machine.notes}\n`);
        if (args[0] === "checkout") machine.at = args[2];
        return answer(true);
    };
    return {
        execFileSync: (command, args, options) => {
            assert.deepEqual([command, args, options], ["pgrep", ["-x", "Discord"], { stdio: "ignore" }]);
            machine.runs.push(command);
            if (machine.pgrepMissing) throw Object.assign(new Error(`spawnSync pgrep ${machine.pgrepMissing}`), { code: machine.pgrepMissing });
            if (!machine.running) throw Object.assign(new Error("pgrep"), { status: machine.pgrepStatus });
        },
        spawnSync: (command, args, options) => {
            machine.runs.push([command, ...args].join(" "));
            machine.cwds.add(options.cwd);
            if (options.stdio === "pipe") machine.piped.push(command);
            if (command === machine.missing) return { error: new Error(`spawnSync ${command} ENOENT`), status: null };
            const answer = (ok, stdout = "", stderr = "") => ({ status: ok ? 0 : 1, stdout: options.stdio === "pipe" ? stdout : null, stderr: options.stdio === "pipe" ? stderr : null });
            const line = args.join(" ");
            if (command === "git") return git(args, answer);
            if (command === "pnpm") return answer({ "check-discord": machine.check, build: machine.build, inject: machine.inject, "install --frozen-lockfile": machine.install, bootstrap: machine.setup }[line]);
            // The release's executable, run for its own steps.
            if (command === process.execPath) return answer({ "check-discord": machine.check, inject: machine.inject }[line]);
            if (command === "launchctl" && args[0] === "print") return answer(machine.loaded);
            if (command === "launchctl") return answer(args[0] === "bootout" ? machine.bootout : machine.bootstrap);
            if (line.includes("display dialog")) return answer(machine.answer, "button returned:yes\n", "execution error: User canceled. (-128)\n");
            if (line.includes("quit app")) machine.running = !machine.quits;
            if (command === "osacompile") compile(args[1], args[3]);
            if (command === "osadecompile") return answer(true, `${fs.readFileSync(args[0], "utf8")}\n`);
            return answer(true);
        }
    };
});

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
const NAME = "Reparchear Discord (agent-chat-bridge)";
const HELPER = () => join(machine.home, "Library", "Application Support", "agent-chat-bridge", `${NAME}.app`);
const APPLY = () => join(machine.home, "Library", "Application Support", "agent-chat-bridge", "repatch-apply.sh");
const RUN = () => join(machine.home, "Library", "Application Support", "agent-chat-bridge", "repatch-run.sh");
const SETTINGS = "open x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles";
const notification = text => `osascript -e display notification ${JSON.stringify(text)} with title "agent-chat-bridge"`;
const DONE = notification("Discord 0.0.422 vuelve a estar parcheado.");
const QUESTION = "Discord se ha actualizado a 0.0.422 y ha perdido el parche de agent-chat-bridge. "
    + "pnpm check-discord da por bueno el parche con el código nuevo. "
    + "¿Lo vuelvo a parchear? Discord se cerrará y se volverá a abrir; si estás en una llamada, se cortará. "
    + "Si no, ejecuta pnpm inject cuando quieras.";
const DIALOG = `osascript -e display dialog ${JSON.stringify(QUESTION)} with title "agent-chat-bridge"`
    + ' buttons {"Ahora no", "Cerrar y parchear"} default button "Cerrar y parchear" cancel button "Ahora no" with icon caution';
/** What a run does up to the question, on an unpatched Discord it hasn't seen. */
const UP_TO_QUESTION = ["git status --porcelain", "pnpm check-discord", DIALOG];
/** How a run ends in a clone that isn't at a release tag, as a development one: it looks for no release. */
const DESCRIBE = "git describe --tags --exact-match --match v* HEAD";

test("discord-app: the patch's files sit in Discord's resources folder, whose build_info.json says its version", async () => {
    const app = await import("../scripts/discord-app.mjs");
    assert.deepEqual([app.resources(), app.asar(), app.original(), app.discordVersion()], [
        "/Applications/Discord.app/Contents/Resources", "/Applications/Discord.app/Contents/Resources/app.asar",
        "/Applications/Discord.app/Contents/Resources/_app.asar", "0.0.422"
    ]);
    machine.installed = false;
    assert.throws(app.resources, { message: "No encuentro Discord instalado. Si acabas de instalarlo, ábrelo una vez: en Windows y "
        + "Linux se instala al arrancar. En Linux, Flatpak y Snap no son compatibles: instala el .deb o el .tar.gz." });
});

test("os: each system has its module, and any other fails saying which ones work", async () => {
    const { systemFor } = await import("../scripts/os/index.mjs");
    assert.deepEqual(["darwin", "linux", "win32"].map(platform => typeof systemFor(platform).installAgent), Array(3).fill("function"));
    assert.throws(() => systemFor("freebsd"), { message: "Sistema no soportado: freebsd. agent-chat-bridge funciona en macOS, Windows y Linux." });
});

test("repatch: without Discord installed it only looks for a release", async () => {
    machine.installed = false;
    await main("run");
    assert.deepEqual(machine.runs, [DESCRIBE]);
    assert.deepEqual(logged.mock.calls, [["Discord is not installed"]]);
});

test("repatch: on a patched Discord it only notes the version, at once, and asks nothing", async () => {
    machine.patched = true;
    await main("run");
    assert.deepEqual(machine.runs, [DESCRIBE]);
    assert.deepEqual(machine.sleeps, []);
    assert.equal(readFileSync(SEEN(), "utf8"), "0.0.422");
});

test("repatch: an update that lost the patch waits for the app to settle, checks it, asks, and on yes quits Discord and opens the helper", async () => {
    await main("run");
    assert.deepEqual(machine.runs, [...UP_TO_QUESTION, "pgrep", 'osascript -e quit app "Discord"', "pgrep", `open ${HELPER()}`, DESCRIBE]);
    assert.deepEqual(machine.sleeps, [30_000]);
    assert.deepEqual([...machine.cwds], [REPO]);
    // Only what the script reads is captured; the rest, pnpm's output included, goes to the log.
    assert.deepEqual(machine.piped, ["git", "osascript", "git"]);
    assert.equal(readFileSync(SEEN(), "utf8"), "0.0.422");
    assert.deepEqual(logged.mock.calls, [["Discord 0.0.422 lost the patch"]]);
});

test("repatch: with Discord closed it opens the helper without quitting Discord", async () => {
    machine.running = false;
    await main("run");
    assert.deepEqual(machine.runs.slice(UP_TO_QUESTION.length), ["pgrep", "pgrep", `open ${HELPER()}`, DESCRIBE]);
});

test("repatch: the helper's apply rebuilds, patches and reopens Discord, and says so", async () => {
    await main("apply");
    assert.deepEqual(machine.runs, ["pnpm build", "pnpm inject", "open -a Discord", DONE]);
    assert.deepEqual(machine.piped, []);
});

test("repatch: a failed build patches nothing, a failed patch says so and points to the permission, and Discord reopens either way", async () => {
    /** @type {[string, string[]][]} */
    const steps = [["build", ["pnpm build"]], ["inject", ["pnpm build", "pnpm inject"]]];
    for (const [step, expected] of steps) {
        Object.assign(machine, { build: true, inject: true, [step]: false, runs: [] });
        vi.resetModules();
        await main("apply");
        assert.deepEqual(machine.runs, [...expected, "open -a Discord", notification(
            `No se ha podido volver a parchear Discord: ha fallado pnpm ${step}. Mira ${LOG()}. Si dice EPERM, `
            + `activa «${NAME}» en Ajustes → Privacidad y seguridad → Gestión de las apps.`)], step);
    }
});

test("repatch: an apply that fails tells the user with a notification and fails with the cause", async () => {
    machine.version = "";
    await assert.rejects(main("apply"), { code: "ENOENT" });
    assert.deepEqual(machine.runs.at(-1), notification(`La comprobación del parche de Discord ha fallado. Mira ${LOG()}.`));
});

test("repatch: on «Ahora no», or a dialog that can't show, it touches nothing and logs why", async () => {
    machine.answer = false;
    await main("run");
    assert.deepEqual(machine.runs, [...UP_TO_QUESTION, DESCRIBE]);
    assert.deepEqual(logged.mock.calls.at(-1), ["Declined: execution error: User canceled. (-128)"]);
});

test("repatch: a version already seen asks nothing again, so a declined one or a patch removed by hand stays quiet", async () => {
    machine.answer = false;
    await main("run");
    machine.runs = [];
    vi.resetModules();
    await main("run");
    assert.deepEqual(machine.runs, [DESCRIBE]);
});

test("repatch: a new version after a seen one asks again", async () => {
    await main("run");
    Object.assign(machine, { version: "0.0.423", runs: [] });
    vi.resetModules();
    await main("run");
    assert.equal(machine.runs[2], DIALOG.replace("0.0.422", "0.0.423"));
    assert.equal(readFileSync(SEEN(), "utf8"), "0.0.423");
});

test("repatch: a Discord patched while the update settles asks nothing", async () => {
    machine.onSleep = () => void (machine.patched = true);
    await main("run");
    assert.deepEqual(machine.runs, [DESCRIBE]);
});

test("repatch: with uncommitted changes it doesn't check or ask, and says to review them", async () => {
    machine.dirty = " M mod/src/main.ts\n";
    await main("run");
    assert.deepEqual(machine.runs, ["git status --porcelain", notification(
        "Discord se ha actualizado a 0.0.422 y ha perdido el parche, pero el repo tiene cambios sin commit. Revísalos y ejecuta pnpm inject."), DESCRIBE]);
});

test("repatch: when pnpm check-discord fails it doesn't ask, and says where to look", async () => {
    machine.check = false;
    await main("run");
    assert.deepEqual(machine.runs.slice(2), [notification("Discord se ha actualizado a 0.0.422 y el parche ya no encaja con su código. "
        + `Mira ${LOG()} y adapta mod/ (AGENTS.md, «When Discord updates»).`), DESCRIBE]);
});

test("repatch: a Discord that doesn't quit in 30 s is left unpatched, with a notification", async () => {
    machine.quits = false;
    await main("run");
    const after = machine.runs.slice(UP_TO_QUESTION.length);
    assert.deepEqual(after.slice(-2), [notification("Discord no se ha cerrado, así que no lo he vuelto a parchear. Ciérralo y ejecuta pnpm inject."), DESCRIBE]);
    assert.equal(after.filter(run => run === "pgrep").length, 32);
    assert.deepEqual(machine.sleeps, [30_000, ...Array(30).fill(1_000)]);
});

test("repatch: a run that fails tells the user with a notification and fails with the cause", async () => {
    machine.version = "";
    await assert.rejects(main("run"), { code: "ENOENT" });
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

test("repatch: without pgrep, as on a minimal Linux, it fails saying what to install; another failure to start it, as it is", async () => {
    machine.pgrepMissing = "ENOENT";
    await assert.rejects(main("run"), {
        message: "Falta pgrep, que dice si Discord está abierto: instálalo (en Debian y Ubuntu, el paquete procps) y repite."
    });
    machine.pgrepMissing = "EACCES";
    vi.resetModules();
    rmSync(SEEN(), { force: true });
    await assert.rejects(main("run"), { message: "spawnSync pgrep EACCES" });
});

/** A clone installed at v0.2.2, its Discord patched, and the runs of its check up to the release's dialog. */
const AT_RELEASE = { patched: true, at: "v0.2.2", remote: ["v0.2.1", "v0.2.2", "v0.3.0", "v0.10.0", "v0.11", "v1.0.0-beta"], notes: "Tested with Discord 0.0.423.\n\n### Fixed\n- A hang." };
const UPDATE_DIALOG = notes => `osascript -e display dialog ${JSON.stringify("Hay una versión nueva de agent-chat-bridge: 0.10.0 (tienes la 0.2.2)."
    + `\n\n${notes}\n\n¿La instalo? Discord se cerrará y se volverá a abrir; si estás en una llamada, se cortará.`)} with title "agent-chat-bridge"`
    + ' buttons {"Ahora no", "Instalar"} default button "Instalar" cancel button "Ahora no" with icon caution';
const UP_TO_UPDATE = [DESCRIBE, "git status --porcelain", "git ls-remote --tags --refs origin v*",
    "git fetch --no-tags origin refs/tags/v0.10.0:refs/tags/v0.10.0", "git tag --list --format=%(contents:body) v0.10.0",
    UPDATE_DIALOG("Tested with Discord 0.0.423.\n\nFixed:\n• A hang.")];
const SET_UP = ["pnpm install --frozen-lockfile", "pnpm bootstrap"];

test("update: a clone at a release offers the newest release with its notes, and on yes installs it and reloads Discord", async () => {
    Object.assign(machine, AT_RELEASE);
    await main("run");
    assert.deepEqual(machine.runs, [...UP_TO_UPDATE, "git checkout --quiet v0.10.0", ...SET_UP,
        "pgrep", 'osascript -e quit app "Discord"', "pgrep", `open ${HELPER()}`]);
    assert.deepEqual(logged.mock.calls, [["Updating v0.2.2 to v0.10.0"]]);
});

test("update: each release is offered once, so a declined one stays quiet", async () => {
    Object.assign(machine, AT_RELEASE, { answer: false });
    await main("run");
    assert.deepEqual(machine.runs, UP_TO_UPDATE);
    Object.assign(machine, { runs: [] });
    vi.resetModules();
    await main("run");
    assert.deepEqual(machine.runs, UP_TO_UPDATE.slice(0, 3));
});

test("update: a newer release after a declined one is offered", async () => {
    Object.assign(machine, AT_RELEASE, { answer: false });
    await main("run");
    Object.assign(machine, { remote: ["v0.10.1"], runs: [] });
    vi.resetModules();
    await main("run");
    assert.equal(machine.runs[3], "git fetch --no-tags origin refs/tags/v0.10.1:refs/tags/v0.10.1");
});

test("update: versions compare part by part as numbers, and only whole vX.Y.Z tags are releases", async () => {
    /** @type {[string[], string][]} */
    const cases = [[["v0.2.9", "v0.2.10"], "v0.2.10"], [["v9.9.9", "v10.0.0"], "v10.0.0"], [["v0.3.0", "xv9.0.0", "v9.0.0x"], "v0.3.0"]];
    for (const [remote, newest] of cases) {
        Object.assign(machine, AT_RELEASE, { remote, answer: false, runs: [] });
        rmSync(join(machine.home, "Library", "Application Support", "agent-chat-bridge", "update-seen-release"), { force: true });
        vi.resetModules();
        await main("run");
        assert.equal(machine.runs[3], `git fetch --no-tags origin refs/tags/${newest}:refs/tags/${newest}`, remote.join(" "));
    }
});

test("update: with no newer release, or none listed, it fetches and asks nothing", async () => {
    for (const remote of [["v0.2.1", "v0.2.2"], ["v0.1.9"], []]) {
        Object.assign(machine, AT_RELEASE, { remote, runs: [] });
        vi.resetModules();
        await main("run");
        assert.deepEqual(machine.runs, UP_TO_UPDATE.slice(0, 3), remote.join(" "));
    }
});

test("update: offline it only notes in the log that releases weren't checked", async () => {
    Object.assign(machine, AT_RELEASE, { remote: null });
    await main("run");
    assert.deepEqual(machine.runs, UP_TO_UPDATE.slice(0, 3));
    assert.deepEqual(logged.mock.calls, [["Releases not checked: fatal: unable to access"]]);
});

test("update: a clone with local changes, at a tag that isn't a release, or off any tag is never updated", async () => {
    /** @type {[string, string][]} */
    const clones = [["v0.2.2", " M README.md\n"], ["v0.2", ""], ["", ""]];
    for (const [at, dirty] of clones) {
        Object.assign(machine, AT_RELEASE, { at, dirty, runs: [] });
        vi.resetModules();
        await main("run");
        assert.deepEqual(machine.runs, [DESCRIBE, ...at === "v0.2.2" ? ["git status --porcelain"] : []], at);
    }
});

test("update: a failed install or setup goes back to the release it was at, sets it up again, and says so", async () => {
    const failed = notification(`No se ha podido instalar la versión 0.10.0: ha fallado su instalación. Sigues con la 0.2.2. Mira ${LOG()}.`);
    /** @type {[string, string[]][]} */
    const steps = [["install", ["pnpm install --frozen-lockfile"]], ["setup", SET_UP]];
    for (const [step, tried] of steps) {
        Object.assign(machine, AT_RELEASE, { install: true, setup: true, [step]: false, runs: [] });
        rmSync(join(machine.home, "Library", "Application Support", "agent-chat-bridge", "update-seen-release"), { force: true });
        vi.resetModules();
        await main("run");
        assert.deepEqual(machine.runs.slice(UP_TO_UPDATE.length), ["git checkout --quiet v0.10.0", ...tried,
            "git checkout --quiet v0.2.2", ...tried, failed], step);
        assert.equal(machine.at, "v0.2.2");
    }
});

test("update: the notes show without the changelog's Markdown", async () => {
    Object.assign(machine, AT_RELEASE, { answer: false, notes: "Tested with Discord 0.0.422.\n\n### Added\n"
        + "- `pnpm repatch install`: after a Discord update removes the patch, a dialog\n  offers to re-patch it.\n- Another - not a ### heading." });
    await main("run");
    assert.equal(machine.runs.at(-1), UPDATE_DIALOG("Tested with Discord 0.0.422.\n\nAdded:\n"
        + "• pnpm repatch install: after a Discord update removes the patch, a dialog offers to re-patch it.\n• Another - not a ### heading."));
});

test("update: long notes are cut to what a dialog shows", async () => {
    Object.assign(machine, AT_RELEASE, { notes: "a".repeat(801), answer: false });
    await main("run");
    assert.equal(machine.runs.at(-1), UPDATE_DIALOG(`${"a".repeat(800)}…`));
    Object.assign(machine, { notes: "a".repeat(800), runs: [] });
    rmSync(join(machine.home, "Library", "Application Support", "agent-chat-bridge", "update-seen-release"));
    vi.resetModules();
    await main("run");
    assert.equal(machine.runs.at(-1), UPDATE_DIALOG("a".repeat(800)));
});

/** What the helper's AppleScript runs: the script beside it, which each install rewrites. */
const HELPER_SOURCE = () => `do shell script ${JSON.stringify(`/bin/sh '${APPLY()}'`)}`;
/** What a first install runs to build the helper, under the name the App Management list shows. */
const BUILD_HELPER = () => {
    const info = join(HELPER(), "Contents", "Info.plist");
    return [
        `osacompile -o ${HELPER()} -e ${HELPER_SOURCE()}`,
        `plutil -replace CFBundleExecutable -string ${NAME} ${info}`,
        `plutil -replace CFBundleName -string ${NAME} ${info}`,
        `plutil -replace CFBundleIdentifier -string local.agent-chat-bridge.repatch.helper ${info}`,
        `codesign --force --sign - ${HELPER()}`
    ];
};

test("repatch: a first install builds the helper, writes and loads the LaunchAgent, and shows where to grant the permission", async () => {
    await main("install");
    assert.deepEqual(machine.runs, [
        "launchctl print gui/501/local.agent-chat-bridge.repatch", ...BUILD_HELPER(),
        `launchctl bootstrap gui/501 ${PLIST()}`, `open -R ${HELPER()}`, SETTINGS
    ]);
    assert.equal(existsSync(join(HELPER(), "Contents", "MacOS", NAME)), true);
    assert.equal(existsSync(join(HELPER(), "Contents", "MacOS", "applet")), false);
    assert.deepEqual(logged.mock.calls, [
        ["Instalado: al actualizarse Discord, se te preguntará si volver a parchearlo, y al salir una versión nueva "
            + `de agent-chat-bridge, si instalarla. El registro está en ${LOG()}.`],
        [`Falta un paso: arrastra «${NAME}», que te he mostrado en el Finder, a Ajustes → Privacidad y seguridad → `
            + "Gestión de las apps, que te he abierto, y actívala. Sin ese permiso, macOS no la deja parchear Discord."]
    ]);
});

test("repatch: a new install keeps a helper with the same AppleScript, so it keeps its permission, and rebuilds a different one", async () => {
    await main("install");
    Object.assign(machine, { runs: [], loaded: true });
    vi.resetModules();
    await main("install");
    assert.deepEqual(machine.runs, [
        "launchctl print gui/501/local.agent-chat-bridge.repatch", `launchctl bootout gui/501 ${PLIST()}`,
        `osadecompile ${join(HELPER(), "Contents", "Resources", "Scripts", "main.scpt")}`, `launchctl bootstrap gui/501 ${PLIST()}`
    ]);
    assert.equal(logged.mock.calls.length, 3);
    writeFileSync(join(HELPER(), "Contents", "Resources", "Scripts", "main.scpt"), "do shell script \"true\"");
    Object.assign(machine, { runs: [], loaded: false });
    vi.resetModules();
    await main("install");
    assert.deepEqual(machine.runs.slice(2, 7), BUILD_HELPER());
});

test("repatch: the helper's and the LaunchAgent's scripts run apply and run from the repo, with the install's PATH, into the log", async () => {
    const saved = process.env.PATH;
    try {
        process.env.PATH = "/it's/bin:/usr/bin";
        await main("install");
        /** @type {[string, string][]} */
        const scripts = [[APPLY(), "apply"], [RUN(), "run"]];
        for (const [file, command] of scripts) {
            assert.equal(readFileSync(file, "utf8"), `cd '${REPO}' && PATH='/it'\\''s/bin:/usr/bin' exec 'node' `
                + `'--disable-warning=MODULE_TYPELESS_PACKAGE_JSON' '${fileURLToPath(new URL("../scripts/repatch.mjs", import.meta.url))}' '${command}' >> '${LOG()}' 2>&1\n`);
        }
        delete process.env.PATH;
        vi.resetModules();
        await main("install");
        assert.match(readFileSync(RUN(), "utf8"), / PATH='' exec /);
    } finally {
        process.env.PATH = saved;
    }
});

test("repatch: install writes the LaunchAgent that runs the check at login, when Discord changes and daily", async () => {
    await main("install");
    assert.deepEqual(machine.piped, ["launchctl", "osacompile", "plutil", "plutil", "plutil", "codesign"]);
    assert.equal(readFileSync(PLIST(), "utf8"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>local.agent-chat-bridge.repatch</string>
    <key>ProgramArguments</key>
    <array><string>/bin/sh</string><string>${RUN()}</string></array>
    <key>WorkingDirectory</key><string>${REPO}</string>
    <key>WatchPaths</key>
    <array><string>/Applications</string><string>/Applications/Discord.app/Contents/Resources</string></array>
    <key>RunAtLoad</key><true/>
    <key>StartInterval</key><integer>86400</integer>
    <key>StandardOutPath</key><string>${LOG()}</string>
    <key>StandardErrorPath</key><string>${LOG()}</string>
</dict>
</plist>
`);
});

test("repatch: the LaunchAgent escapes what XML would read as markup", async () => {
    rmSync(machine.home, { recursive: true, force: true });
    // Windows allows no `<` in a file's name.
    const lt = platform === "win32" ? ["", ""] : ["<", "&lt;"];
    machine.home = mkdtempSync(join(tmpdir(), `repatch-a&b${lt[0]}c-`));
    await main("install");
    assert.match(readFileSync(PLIST(), "utf8"), new RegExp(`<string>[^<]*repatch-a&amp;b${lt[1]}c-[^<]*repatch-run\\.sh</string>`));
});

test("repatch: install fails, saying why, without Discord installed", async () => {
    machine.installed = false;
    await assert.rejects(main("install"), { message: /^No encuentro Discord instalado/ });
    assert.deepEqual(machine.runs, []);
});

test("repatch: install fails when launchctl can't load the agent or unload the old one", async () => {
    machine.bootstrap = false;
    await assert.rejects(main("install"), { message: `launchctl couldn't load ${PLIST()}` });
    Object.assign(machine, { bootstrap: true, loaded: true, bootout: false });
    vi.resetModules();
    await assert.rejects(main("install"), { message: "launchctl couldn't unload local.agent-chat-bridge.repatch" });
});

test("repatch: uninstall unloads a loaded agent and removes it, the helper and its script", async () => {
    await main("install");
    for (const loaded of [true, false]) {
        Object.assign(machine, { loaded, runs: [] });
        vi.resetModules();
        await main("uninstall");
        assert.deepEqual(machine.runs, [
            "launchctl print gui/501/local.agent-chat-bridge.repatch", ...loaded ? [`launchctl bootout gui/501 ${PLIST()}`] : []
        ]);
        assert.deepEqual([PLIST(), HELPER(), APPLY(), RUN()].filter(existsSync), []);
    }
    assert.deepEqual(logged.mock.calls.slice(-2), [
        ["Desinstalado: Discord ya no se vuelve a parchear tras actualizarse."], [`Quita «${NAME}» de Gestión de las apps.`]]);
});

test("repatch: uninstall needs no Discord installed", async () => {
    await main("install");
    machine.installed = false;
    vi.resetModules();
    await main("uninstall");
    assert.deepEqual([PLIST(), HELPER(), APPLY(), RUN()].filter(existsSync), []);
});

test("repatch: a failure's notice adds the system's permission hint only where it has one", async () => {
    vi.doMock("../scripts/os/index.mjs", async () => {
        const darwin = await import("../scripts/os/darwin.mjs");
        return { system: { ...darwin, permissionHint: "" } };
    });
    machine.build = false;
    await main("apply");
    assert.equal(machine.runs.at(-1), notification(`No se ha podido volver a parchear Discord: ha fallado pnpm build. Mira ${LOG()}.`));
    vi.doUnmock("../scripts/os/index.mjs");
});

test("repatch: any other command prints the usage and fails", async () => {
    for (const command of [undefined, "inject"]) {
        await main(command);
        assert.equal(process.exitCode, 2);
    }
    assert.deepEqual(errors.mock.calls, Array(2).fill(["Uso: node scripts/repatch.mjs install|uninstall|run|apply"]));
    assert.deepEqual(machine.runs, []);
});

/**
 * The release's executable: no clone, the files it carries, as node:sea hands them, and the executable itself, a file
 * in the temporary HOME, never the Node that runs the tests.
 */
const NODE = process.execPath;
const asExecutable = () => {
    vi.doMock("node:sea", () => ({
        isSea: () => true,
        getAsset: (key, encoding) => key === "files.json" ? JSON.stringify(["mod/dist/main.js"]) : encoding ? "" : new TextEncoder().encode(`// ${key}`).buffer
    }));
    const path = join(machine.home, "agent-chat-bridge");
    writeFileSync(path, "old");
    Object.defineProperty(process, "execPath", { value: path });
    return path;
};
afterEach(() => {
    vi.doUnmock("node:sea");
    Object.defineProperty(process, "execPath", { value: NODE });
});
const EXE = () => join(machine.home, "agent-chat-bridge");
const STATE_DIR = () => join(machine.home, "Library", "Application Support", "agent-chat-bridge");
const exeQuestion = QUESTION.replaceAll("pnpm", "agent-chat-bridge");

test("repatch, executable: an update that lost the patch is checked by its own command, with no clone to look at, and asks", async () => {
    asExecutable();
    await main("run");
    assert.deepEqual(machine.runs, [`${EXE()} check-discord`, DIALOG.replace(JSON.stringify(QUESTION), JSON.stringify(exeQuestion)),
        "pgrep", 'osascript -e quit app "Discord"', "pgrep", `open ${HELPER()}`]);
    assert.deepEqual([...machine.cwds], [undefined], "it runs from no clone");
});

test("repatch, executable: a failed check says a new release will adapt the patch", async () => {
    asExecutable();
    machine.check = false;
    await main("run");
    assert.deepEqual(machine.runs.at(-1), notification("Discord se ha actualizado a 0.0.422 y el parche ya no encaja con su código. "
        + "Discord funciona sin los plugins hasta que una versión nueva de agent-chat-bridge lo adapte, que se te ofrecerá aquí. "
        + `Mira ${LOG()}.`));
});

test("repatch, executable: apply unpacks the files it carries, patches with its own command and reopens Discord", async () => {
    asExecutable();
    await main("apply");
    assert.deepEqual(machine.runs, [`${EXE()} inject`, "open -a Discord", DONE]);
    assert.equal(readFileSync(join(STATE_DIR(), "mod", "dist", "main.js"), "utf8"), "// mod/dist/main.js");
    machine.inject = false;
    machine.runs = [];
    vi.resetModules();
    await main("apply");
    assert.match(machine.runs.at(-1), /ha fallado agent-chat-bridge inject\./);
});

test("repatch, executable: where Dictation was installed, apply installs its packages again, and a failure says which step", async () => {
    asExecutable();
    const worker = join(STATE_DIR(), "dictation", "worker");
    mkdirSync(worker, { recursive: true });
    await main("apply");
    assert.equal(machine.runs[0], `${EXE()} inject`, "the worker's files without its packages: Dictation was never installed");
    mkdirSync(join(worker, ".venv"));
    Object.assign(machine, { runs: [] });
    vi.resetModules();
    await main("apply");
    assert.deepEqual(machine.runs, [`setUpDictation ${join(STATE_DIR(), "tools", "uv")} ${worker} false`, `${EXE()} inject`, "open -a Discord", DONE]);
    Object.assign(machine, { sync: 1, runs: [] });
    vi.resetModules();
    await main("apply");
    assert.equal(machine.runs.length, 3, "no patch after a failed install");
    assert.match(machine.runs.at(-1), /ha fallado agent-chat-bridge install --dictation\./);
});

test("repatch, executable: the scripts run its repatch command, and the LaunchAgent has no clone to start in", async () => {
    asExecutable();
    await main("install");
    assert.match(readFileSync(RUN(), "utf8"), new RegExp(`^PATH='[^']*' exec '${EXE().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}' 'repatch' 'run' >> `));
    assert.match(readFileSync(PLIST(), "utf8"), /repatch-run\.sh<\/string><\/array>\n {4}<key>WatchPaths<\/key>/);
    await main("nada");
    assert.deepEqual(errors.mock.calls.at(-1), ["Uso: agent-chat-bridge repatch install|uninstall|run|apply"]);
});

/** A release on GitHub with this system's executable, signed by the test's release key unless `signedBy` says otherwise. */
async function publish(tag, bytes = "new", { platform: os = "darwin", signedBy = machine.keys } = {}) {
    const { executableName } = await import("../scripts/bundle.mjs");
    const { generateKeyPairSync, sign } = await import("node:crypto");
    const name = executableName(os, process.arch);
    const key = signedBy ?? generateKeyPairSync("ed25519");
    machine.files = { [`https://gh/${name}`]: new TextEncoder().encode(bytes), [`https://gh/${name}.sig`]: sign(null, Buffer.from(bytes), key.privateKey) };
    machine.release = { tag, notes: "### Added\n- `x`, nuevo.", files: { [name]: `https://gh/${name}`, [`${name}.sig`]: `https://gh/${name}.sig` } };
    return name;
}
const CURRENT = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const UPDATE = tag => `Hay una versión nueva de agent-chat-bridge: ${tag.slice(1)} (tienes la ${CURRENT}).\n\nAdded:\n• x, nuevo.\n\n`
    + "¿La instalo? Discord se cerrará y se volverá a abrir; si estás en una llamada, se cortará.";
const updateDialog = tag => `osascript -e display dialog ${JSON.stringify(UPDATE(tag))} with title "agent-chat-bridge" buttons {"Ahora no", "Instalar"}`
    + ' default button "Instalar" cancel button "Ahora no" with icon caution';

test("update, executable: a newer release is offered once with its notes; on yes its signed executable replaces this one and Discord reloads", async () => {
    const exe = asExecutable();
    machine.patched = true;
    // Before the patch's module loads its key, so the release can be signed with it.
    await import("../scripts/release-key.mjs");
    await publish("v99.0.0");
    await main("run");
    assert.deepEqual(machine.runs, [updateDialog("v99.0.0"), "pgrep", 'osascript -e quit app "Discord"', "pgrep", `open ${HELPER()}`]);
    assert.equal(readFileSync(exe, "utf8"), "new");
    assert.deepEqual([`${exe}.new`, `${exe}.old`].filter(existsSync), [], "outside Windows the rename replaces it, leaving nothing");
    assert.equal(machine.downloads.length, 2);
    assert.deepEqual(logged.mock.calls.at(-1), [`Updating v${CURRENT} to v99.0.0`]);
    if (platform !== "win32") assert.equal(statSync(exe).mode & 0o777, 0o755, "the new executable can run");
    machine.runs = [];
    vi.resetModules();
    await main("run");
    assert.deepEqual(machine.runs, [], "each release is offered once");
});

test("update, executable: declined, nothing is downloaded; a release that isn't newer, isn't one, or lacks this system's executable asks nothing", async () => {
    asExecutable();
    machine.patched = true;
    await import("../scripts/release-key.mjs");
    machine.answer = false;
    await publish("v99.0.0");
    await main("run");
    assert.deepEqual([machine.runs, machine.downloads], [[updateDialog("v99.0.0")], []]);
    for (const tag of [`v${CURRENT}`, "v0.0.1", "nightly"]) {
        await publish(tag);
        machine.runs = [];
        vi.resetModules();
        await main("run");
        assert.deepEqual(machine.runs, [], tag);
    }
    await publish("v99.1.0", "new", { platform: "linux" });
    vi.resetModules();
    await main("run");
    assert.deepEqual(machine.runs, []);
    assert.equal(logged.mock.calls.at(-1)?.[0], `v99.1.0 has no agent-chat-bridge-darwin-${process.arch} and its signature`);
    machine.release = null;
    vi.resetModules();
    await main("run");
    assert.deepEqual(machine.runs, [], "offline, as release-feed.mjs says in the log");
});

test("update, executable: an executable not signed by the release key is not installed, and the user is told", async () => {
    const exe = asExecutable();
    machine.patched = true;
    await import("../scripts/release-key.mjs");
    await publish("v99.0.0", "new", { signedBy: null });
    await main("run");
    assert.equal(readFileSync(exe, "utf8"), "old");
    assert.deepEqual(machine.runs.at(-1), notification(`La versión 99.0.0 de agent-chat-bridge no lleva una firma válida, así que no la he instalado. Sigues con la ${CURRENT}.`));
});

test("update, executable: on Windows the running executable is renamed aside, and the next run removes it", async () => {
    const exe = asExecutable();
    machine.patched = true;
    await import("../scripts/release-key.mjs");
    await publish("v99.0.0", "new", { platform: "win32" });
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
        await main("run");
    } finally {
        Object.defineProperty(process, "platform", { value: "darwin" });
    }
    assert.deepEqual([readFileSync(exe, "utf8"), readFileSync(`${exe}.old`, "utf8")], ["new", "old"]);
    machine.release = null;
    vi.resetModules();
    await main("run");
    assert.equal(existsSync(`${exe}.old`), false);
});

test("repatch, executable: where apply runs at once, it runs the executable on disk, the new one after an update", async () => {
    asExecutable();
    vi.doMock("../scripts/os/index.mjs", async () => {
        const darwin = await import("../scripts/os/darwin.mjs");
        return { system: { ...darwin, runApply: agent => agent.apply() } };
    });
    machine.running = false;
    await main("run");
    assert.equal(machine.runs.at(-1), `${EXE()} repatch apply`);
    vi.doUnmock("../scripts/os/index.mjs");
});
