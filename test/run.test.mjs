// How the main process runs `claude -p` for the plugins (plugins/shared/run.ts), on a faked execFile and temporary
// folder: what the page may choose, the isolation flags, and every way the run ends. Run with `pnpm test`.
import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, test, vi } from "vitest";

/** Each run: the binary, its arguments and options, the callback, and what went to its stdin. @type {any[]} */
const runs = vi.hoisted(() => []);
const folders = vi.hoisted(() => ({ made: /** @type {string[]} */ ([]), removed: /** @type {any[]} */ ([]) }));
/** Whether the next run gets a stdin pipe, as execFile always gives one. */
const pipe = vi.hoisted(() => ({ stdin: true }));
vi.mock("child_process", () => ({
    execFile: (file, args, options, callback) => {
        const run = { file, args, options, callback, input: /** @type {string | undefined} */ (undefined), killed: false };
        runs.push(run);
        return {
            stdin: pipe.stdin ? { end: text => void (run.input = text) } : null,
            kill: () => void (run.killed = true)
        };
    }
}));
vi.mock("fs/promises", () => ({
    mkdtemp: async prefix => (folders.made.push(prefix), `${prefix}abc`),
    rm: async (path, options) => void folders.removed.push([path, options])
}));

// Typed loosely: the tests send what a page script could, of any type.
const { runClaude } = /** @type {any} */ (await import("../plugins/shared/run.ts"));

const event = /** @type {any} */ ({});
beforeEach(() => {
    runs.length = 0;
    folders.made.length = 0;
    folders.removed.length = 0;
});

/** Runs Claude and ends the run with `stdout`, or with an error. @param {{ err?: Error | null, stdout?: string, stderr?: string }} end */
async function answer({ err = null, stdout = "", stderr = "" } = {}) {
    const result = runClaude(event, "sistema", "entrada", "claude-sonnet-5-5");
    await vi.waitFor(() => assert.equal(runs.length, 1));
    runs[0].callback(err, stdout, stderr);
    return result;
}

test("run: claude from the user's bin, isolated, in a throwaway folder, with the input on stdin", async () => {
    assert.deepEqual(await answer({ stdout: "  hola \n" }), { ok: true, text: "hola" });
    const [{ file, args, options, input }] = runs;
    assert.equal(file, join(homedir(), ".local/bin/claude"));
    assert.deepEqual(args, [
        "-p", "--safe-mode", "--settings", '{"language":""}', "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--effort", "low",
        "--model", "claude-sonnet-5-5", "--system-prompt", "sistema"
    ]);
    const folder = join(tmpdir(), "discord-claude-");
    assert.deepEqual(options, {
        cwd: `${folder}abc`, timeout: 120_000, maxBuffer: 1 << 20,
        env: { HOME: homedir(), USER: process.env.USER, PATH: "/usr/bin:/bin", TMPDIR: tmpdir(), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }
    });
    assert.equal(input, "entrada");
    assert.deepEqual(folders.made, [folder]);
    assert.deepEqual(folders.removed, [[`${folder}abc`, { recursive: true, force: true }]]);
});

test("run: what the page sends picks only the prompt, the input and a Claude model", async () => {
    for (const args of [[1, "x", "claude-x"], ["x", null, "claude-x"], ["x", "x", "gpt-4"], ["x", "x", "claude-X"], ["x", "x", "claude-x; rm"], ["x", "x", "gpt-claude-x"], ["x", "x", 3]])
        assert.deepEqual(await runClaude(event, ...args), { ok: false, text: "Parámetros no válidos" }, JSON.stringify(args));
    assert.equal(runs.length, 0);
    assert.equal(folders.made.length, 0);
});

test("run: an empty answer, or a failed run, says why, and the folder still goes", async () => {
    assert.deepEqual(await answer({ stdout: " \n" }), { ok: false, text: "Respuesta vacía" });
    runs.length = 0;
    assert.deepEqual(await answer({ err: new Error("Command failed"), stderr: " límite de uso \n" }), { ok: false, text: "límite de uso" });
    runs.length = 0;
    assert.deepEqual(await answer({ err: new Error("timeout"), stderr: "  " }), { ok: false, text: "timeout" });
    assert.equal(folders.removed.length, 3);
});

test("run: without a stdin pipe the run is stopped at once instead of waiting for the timeout", async () => {
    pipe.stdin = false;
    const result = await runClaude(event, "s", "i", "claude-x");
    pipe.stdin = true;
    assert.deepEqual(result, { ok: false, text: "claude was started without a stdin pipe" });
    assert.equal(runs[0].killed, true);
});
