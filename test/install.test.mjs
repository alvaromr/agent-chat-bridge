// The CLI's own commands (scripts/install.mjs, through scripts/agent-chat-bridge.mjs): install and uninstall in the
// release's executable, and the steps that hand over to the patcher, the check and the re-patch, all faked. Run with
// `pnpm test`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, test, vi } from "vitest";

import { appDataDir } from "../mod/src/platform.mts";
import pkg from "../package.json" with { type: "json" };

/** The machine: a temporary home, what ran, in order, and whether Discord is patched. */
const fake = vi.hoisted(() => ({ home: "", steps: /** @type {string[]} */ ([]), patched: true }));
vi.mock("node:os", async original => ({ ...(/** @type {any} */ (await original())), homedir: () => fake.home }));
vi.mock("../scripts/inject.mjs", () => ({ patch: command => void fake.steps.push(`patch ${command}`) }));
vi.mock("../scripts/repatch.mjs", () => ({ main: async command => void fake.steps.push(`repatch ${command}`) }));
vi.mock("../scripts/discord-app.mjs", () => ({ original: () => fake.patched ? join(fake.home, "_app.asar") : join(fake.home, "none") }));
// Each check runs as its module loads, as node:test runs a file's tests.
vi.mock("../scripts/check-discord/code.mjs", () => (fake.steps.push("check code"), {}));
vi.mock("../scripts/check-discord/css.mjs", () => (fake.steps.push("check css"), {}));

/** The release's executable, carrying the patch and the skill. */
const asExecutable = () => vi.doMock("node:sea", () => {
    const files = { "mod/dist/main.js": "main", "skills/agent-chat-bridge/SKILL.md": "skill" };
    return {
        isSea: () => true,
        getAsset: (key, encoding) => key === "files.json" ? JSON.stringify(Object.keys(files)) : encoding ? files[key] : new TextEncoder().encode(files[key]).buffer
    };
});
const state = () => join(appDataDir(process.platform, process.env, fake.home), "agent-chat-bridge");
const skill = () => join(fake.home, ".claude", "skills", "agent-chat-bridge");
const cli = async (/** @type {string[]} */ argv) => (await import("../scripts/agent-chat-bridge.mjs")).main(argv);

let out, err;
beforeEach(() => {
    Object.assign(fake, { home: mkdtempSync(join(tmpdir(), "install-")), steps: [], patched: true });
    writeFileSync(join(fake.home, "_app.asar"), "");
    out = vi.spyOn(console, "log").mockImplementation(() => { });
    err = vi.spyOn(console, "error").mockImplementation(() => { });
    process.exitCode = undefined;
});
afterEach(() => {
    vi.doUnmock("node:sea");
    vi.resetModules();
    rmSync(fake.home, { recursive: true, force: true });
    process.exitCode = undefined;
});

test("install: unpacks the files, puts the skill where Claude Code finds it, patches Discord and schedules the check", async () => {
    asExecutable();
    mkdirSync(skill(), { recursive: true });
    writeFileSync(join(skill(), "old.md"), "");
    await cli(["install"]);
    assert.equal(readFileSync(join(state(), "mod", "dist", "main.js"), "utf8"), "main");
    assert.equal(readFileSync(join(skill(), "SKILL.md"), "utf8"), "skill");
    assert.equal(existsSync(join(skill(), "old.md")), false, "an older skill's files go");
    assert.deepEqual(fake.steps, ["patch install", "repatch install"]);
    assert.deepEqual(out.mock.calls, [[`agent-chat-bridge ${pkg.version} instalado. La skill de Claude Code está en ${skill()}. Abre Discord para usarlo.`]]);
});

test("uninstall: takes the check, the patch, the skill and the files away, keeps the settings, and says to delete the executable", async () => {
    asExecutable();
    await cli(["install"]);
    writeFileSync(join(state(), "settings.json"), "{}");
    fake.steps = [];
    await cli(["uninstall"]);
    assert.deepEqual(fake.steps, ["repatch uninstall", "patch uninstall"]);
    assert.deepEqual([skill(), join(state(), "mod"), join(state(), "skills")].filter(existsSync), []);
    assert.equal(existsSync(join(state(), "settings.json")), true);
    assert.deepEqual(out.mock.calls.at(-1), [`agent-chat-bridge desinstalado; tus ajustes siguen en ${state()}. Para terminar, borra ${process.execPath}.`]);
    fake.patched = false;
    fake.steps = [];
    await cli(["uninstall"]);
    assert.deepEqual(fake.steps, ["repatch uninstall"], "an unpatched Discord has no patch to remove");
});

test("install and uninstall: in a clone they do nothing and say how a clone installs", async () => {
    for (const command of ["install", "uninstall"]) {
        await cli([command]);
        assert.equal(process.exitCode, 2);
    }
    assert.deepEqual(fake.steps, []);
    assert.deepEqual(err.mock.calls, Array(2).fill(["En un clon del repo no se usa install ni uninstall: Discord se parchea con pnpm "
        + "inject, la comprobación con pnpm repatch install, y la skill y el comando con pnpm links (AGENTS.md, «Commands»)."]));
});

test("the steps: inject and uninject patch, check-discord runs both checks, repatch passes its command on", async () => {
    await cli(["inject"]);
    await cli(["uninject"]);
    await cli(["check-discord"]);
    await cli(["repatch", "run"]);
    assert.deepEqual(fake.steps, ["patch install", "patch uninstall", "check code", "check css", "repatch run"]);
});

test("--version prints the version, and the help lists the CLI's own commands after Discord's", async () => {
    await cli(["--version"]);
    assert.deepEqual(out.mock.calls, [[pkg.version]]);
    const { buildRequest } = await import("../scripts/agent-chat-bridge.mjs");
    const help = /** @type {{ help: string }} */ (buildRequest([])).help;
    assert.match(help, /\nInstalación y parche:\n {2}install {7}instala el parche/);
    assert.match(help, /\n {2}repatch {7}la comprobación programada.*\n {2}--version {5}muestra la versión$/);
});
