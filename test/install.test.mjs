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

/**
 * The machine: a temporary home, what ran, in order, whether Discord is patched, and for Dictation what uv's install
 * and the model's download answer, and whether the worker can run here.
 */
const fake = vi.hoisted(() => ({ home: "", steps: /** @type {string[]} */ ([]), patched: true, sync: 0, download: /** @type {number | null} */ (0), canRun: true }));
vi.mock("../scripts/setup-dictation.mjs", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    return {
        setUpDictation: (uv, project, dev) => {
            fake.steps.push(`setUpDictation ${uv} ${project} ${dev}`);
            if (fake.canRun && !fake.sync) {
                mkdirSync(join(project, ".venv", "bin"), { recursive: true });
                writeFileSync(join(project, ".venv", "bin", "hf"), "");
            }
            return fake.sync;
        }
    };
});
vi.mock("node:child_process", () => ({
    spawnSync: (command, args, options) => {
        fake.steps.push([command, ...args, options.stdio].join(" "));
        return { status: fake.download };
    }
}));
vi.mock("node:os", async original => ({ ...(/** @type {any} */ (await original())), homedir: () => fake.home }));
vi.mock("../scripts/inject.mjs", () => ({ patch: command => void fake.steps.push(`patch ${command}`) }));
vi.mock("../scripts/repatch.mjs", () => ({ main: async command => void fake.steps.push(`repatch ${command}`) }));
vi.mock("../scripts/discord-app.mjs", () => ({ original: () => fake.patched ? join(fake.home, "_app.asar") : join(fake.home, "none") }));
// Each check runs as its module loads, as node:test runs a file's tests.
vi.mock("../scripts/check-discord/code.mjs", () => (fake.steps.push("check code"), {}));
vi.mock("../scripts/check-discord/css.mjs", () => (fake.steps.push("check css"), {}));

/** The release's executable, carrying the patch and the skill, and Dictation's worker and uv when it has Dictation. */
const asExecutable = (dictation = false) => vi.doMock("node:sea", () => {
    const files = {
        "mod/dist/main.js": "main", "skills/agent-chat-bridge/SKILL.md": "skill",
        ...dictation ? { "dictation/worker/worker.py": "worker", "tools/uv": "uv" } : {}
    };
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
    Object.assign(fake, { home: mkdtempSync(join(tmpdir(), "install-")), steps: [], patched: true, sync: 0, download: 0, canRun: true });
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

const WORKER = () => join(state(), "dictation", "worker");
const HF = () => join(WORKER(), ".venv", "bin", "hf");
const MODEL = "mlx-community/whisper-large-v3-turbo";

test("install --dictation: installs the worker with the uv it carries and downloads the model, before it patches", async () => {
    asExecutable(true);
    await cli(["install", "--dictation"]);
    assert.deepEqual(fake.steps, [`setUpDictation ${join(state(), "tools", "uv")} ${WORKER()} false`, `${HF()} download ${MODEL} inherit`,
        "patch install", "repatch install"]);
    assert.equal(readFileSync(join(WORKER(), "worker.py"), "utf8"), "worker");
    assert.equal(out.mock.calls[0]?.[0], `Dictado: descargando el modelo ${MODEL} (unos 1,6 GB) en la caché de Hugging Face.`);
    assert.equal(process.exitCode, undefined);
});

test("install --dictation: where the worker can't run it installs the rest, as setup-dictation says", async () => {
    asExecutable(true);
    fake.canRun = false;
    await cli(["install", "--dictation"]);
    assert.deepEqual(fake.steps.slice(1), ["patch install", "repatch install"]);
});

test("install --dictation: a failed install or download stops before the patch, with its code; an executable without Dictation says so", async () => {
    asExecutable(true);
    fake.sync = 3;
    await cli(["install", "--dictation"]);
    assert.deepEqual([fake.steps.length, process.exitCode], [1, 3]);
    Object.assign(fake, { sync: 0, download: 4, steps: [] });
    await cli(["install", "--dictation"]);
    assert.deepEqual([fake.steps.length, process.exitCode], [2, 4]);
    assert.deepEqual(err.mock.calls.at(-1), [`Dictado: no se ha podido descargar el modelo ${MODEL}. Repite agent-chat-bridge install --dictation.`]);
    Object.assign(fake, { download: null, steps: [] });
    await cli(["install", "--dictation"]);
    assert.equal(process.exitCode, 1, "a download a signal ended");
    vi.resetModules();
    rmSync(join(state(), "tools"), { recursive: true });
    asExecutable(false);
    Object.assign(fake, { steps: [] });
    process.exitCode = undefined;
    await cli(["install", "--dictation"]);
    assert.deepEqual([fake.steps, process.exitCode], [[], 2]);
    assert.deepEqual(err.mock.calls.at(-1), ["Este ejecutable no trae el dictado: solo lo trae el de Mac con Apple Silicon. Instala sin --dictation."]);
});

test("install: any other option prints the usage and installs nothing", async () => {
    asExecutable();
    await cli(["install", "--all"]);
    assert.deepEqual([fake.steps, process.exitCode, existsSync(state())], [[], 2, false]);
    assert.deepEqual(err.mock.calls, [["Uso: agent-chat-bridge install [--dictation]"]]);
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
