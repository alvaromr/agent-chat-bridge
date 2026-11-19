// Dictation's engine (scripts/setup-dictation.mjs), with the machine and uv faked: it installs the worker's packages
// only where they can run, says why not elsewhere, and returns uv's code, which fails `pnpm bootstrap` when the install
// fails. Run with `pnpm test`.
import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

/** The machine the step runs on, and each command it runs with what it answers. @type {any} */
const machine = vi.hoisted(() => ({ arch: "arm64", release: "25.5.0", uv: true, syncStatus: 0, runs: [] }));
vi.mock("node:os", async original => ({ ...(/** @type {any} */ (await original())), platform: () => "darwin", arch: () => machine.arch, release: () => machine.release }));
vi.mock("node:child_process", () => ({
    spawnSync: (command, args, options) => {
        machine.runs.push([command, ...args, options?.stdio ?? ""].join(" ").trim());
        if (!machine.uv) return { error: Object.assign(new Error("spawnSync uv ENOENT"), { code: "ENOENT" }), status: null };
        return { status: args[0] === "sync" ? machine.syncStatus : 0 };
    }
}));

let warned;
beforeEach(() => {
    Object.assign(machine, { arch: "arm64", release: "25.5.0", uv: true, syncStatus: 0, runs: [] });
    warned = vi.spyOn(console, "warn").mockImplementation(() => { });
});
const { setUpDictation } = await import("../scripts/setup-dictation.mjs");

test("setup-dictation: on an Apple Silicon Mac with uv, it installs the worker's packages as uv.lock pins them", () => {
    assert.equal(setUpDictation(), 0);
    assert.deepEqual(machine.runs, ["uv --version", "uv sync --frozen --project dictation/worker inherit"]);
    assert.equal(warned.mock.calls.length, 0);
});

test("setup-dictation: the executable hands it the uv it carries and the worker it unpacked, and wants no development tools", () => {
    assert.equal(setUpDictation("/state/tools/uv", "/state/dictation/worker", false), 0);
    assert.deepEqual(machine.runs, ["/state/tools/uv --version", "/state/tools/uv sync --frozen --no-dev --project /state/dictation/worker inherit"]);
});

test("setup-dictation: a failed install returns uv's own code, or 1 when a signal ended uv", () => {
    machine.syncStatus = 2;
    assert.equal(setUpDictation(), 2);
    machine.syncStatus = null;
    assert.equal(setUpDictation(), 1);
});

test("setup-dictation: on an Intel Mac, or before macOS 14, it installs nothing and says why", () => {
    for (const [arch, release] of [["x64", "25.5.0"], ["arm64", "22.6.0"]]) {
        Object.assign(machine, { arch, release, runs: [] });
        assert.equal(setUpDictation(), 0);
        assert.deepEqual(machine.runs, [], `${arch} ${release}`);
    }
    assert.deepEqual(warned.mock.calls.map(([text]) => text), Array(2).fill(
        "Dictado: no se instala, porque necesita un Mac con Apple Silicon y macOS 14 o posterior. El resto de agent-chat-bridge sí."));
});

test("setup-dictation: without uv it installs nothing and says how to get it", () => {
    machine.uv = false;
    assert.equal(setUpDictation(), 0);
    assert.deepEqual(machine.runs, ["uv --version"]);
    assert.deepEqual(warned.mock.calls.map(([text]) => text),
        ["Dictado: no se instala, porque falta uv (https://docs.astral.sh/uv/). Instálalo y repite `pnpm bootstrap`. El resto de agent-chat-bridge sí."]);
});
