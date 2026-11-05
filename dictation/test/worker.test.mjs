// The worker launcher (dictation/src/worker.ts) on a fake child process: how it starts the worker, and every way the
// worker can answer or fail. The real worker runs in dictation/test/worker.mjs (`pnpm smoke-dictation`).
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname } from "node:path";

import { afterEach, beforeEach, test, vi } from "vitest";

import { encodeRequest } from "../src/protocol.ts";

/** Each spawn: its command, arguments and options, and the fake child. @type {any[]} */
const spawned = vi.hoisted(() => []);
vi.mock("child_process", async () => {
    const { EventEmitter } = await import("node:events");
    const { PassThrough } = await import("node:stream");
    return {
        spawn: (command, args, options) => {
            /** @type {Buffer[]} */
            const written = [];
            const child = Object.assign(new EventEmitter(), {
                stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed: 0,
                kill() { child.killed++; },
                /** What the launcher wrote to the worker's stdin. */
                written: () => Buffer.concat(written)
            });
            child.stdin.on("data", chunk => written.push(chunk));
            spawned.push({ command, args, options, child });
            return child;
        }
    };
});

const { startWorker } = await import("../src/worker.ts");

const tick = () => new Promise(r => setTimeout(r, 0));
const last = () => spawned.at(-1).child;
/** The worker writes to its stdout or stderr, and the launcher reads it. */
async function say(stream, text) {
    last()[stream].write(text);
    await tick();
}
async function ready() {
    const started = startWorker("/repo/dictation", "/models/turbo", "es");
    await say("stdout", '{"ready": true}\n');
    return started;
}

beforeEach(() => void (spawned.length = 0));
afterEach(() => vi.useRealTimers());

test("worker: the Python of its venv, isolated, under a sandbox without network that writes only to the user's temp folder", async () => {
    await ready();
    const { command, args, options } = spawned[0];
    assert.equal(command, "/usr/bin/sandbox-exec");
    assert.deepEqual(args.slice(0, 2), ["-D", `USER=${dirname(realpathSync(tmpdir()))}`]);
    assert.equal(args[2], "-p");
    assert.match(args[3], /^\(version 1\)\(allow default\)\(deny network\*\)\s*\(deny file-write\*\)\(allow file-write\* \(subpath "\/dev"\) \(subpath \(param "USER"\)\)\)$/);
    assert.deepEqual(args.slice(4), ["/repo/dictation/worker/.venv/bin/python", "-I", "/repo/dictation/worker/worker.py", "/models/turbo", "es"]);
    assert.deepEqual(options, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { HOME: homedir(), PATH: "/usr/bin:/bin", TMPDIR: tmpdir(), HF_HUB_OFFLINE: "1" }
    });
});

test("worker: resolves once the model is loaded; answers come back in the order of the requests, lines split or not", async () => {
    const worker = await ready();
    const samples = Float32Array.of(0.5, -0.25);
    const first = worker.transcribe(samples, "Hablamos de git.");
    const second = worker.transcribe(samples, null);
    assert.deepEqual(last().written(), Buffer.concat([encodeRequest(samples, "Hablamos de git."), encodeRequest(samples, null)]));
    await say("stdout", '{"text": "uno"}\n{"te');
    await say("stdout", 'xt": "dos"}\n');
    assert.equal(await first, "uno");
    assert.equal(await second, "dos");
});

test("worker: an answer to no request fails it, kills it, and every later request gets the failure", async () => {
    const worker = await ready();
    await say("stdout", '{"text": "nadie lo pidió"}\n');
    assert.equal(last().killed, 1);
    await assert.rejects(worker.transcribe(new Float32Array(1), null), { message: "dictation worker the worker answered a request it was not sent" });
});

test("worker: a line outside the protocol before it is ready rejects the start, with stderr's last line", async () => {
    const started = assert.rejects(startWorker("/repo/dictation", "/models/turbo", "es"),
        { message: "dictation worker the worker answered outside the protocol: ValueError: bad model" });
    await say("stderr", "Traceback (most recent call last):\n  ValueError: bad model\n");
    await say("stdout", '{"hola": 1}\n');
    await started;
});

test("worker: a line that is not JSON fails the requests waiting", async () => {
    const worker = await ready();
    const waiting = assert.rejects(worker.transcribe(new Float32Array(1), null), { name: "Error", message: /^dictation worker .*JSON/ });
    await say("stdout", "no es json\n");
    await waiting;
});

test("worker: an exit before it is ready rejects the start, with the code or the signal", async () => {
    const started = startWorker("/repo/dictation", "/models/turbo", "es");
    last().emit("exit", 1, null);
    await assert.rejects(started, { message: "dictation worker exited (1)" });
    const killed = startWorker("/repo/dictation", "/models/turbo", "es");
    last().emit("exit", null, "SIGKILL");
    await assert.rejects(killed, { message: "dictation worker exited (SIGKILL)" });
});

test("worker: an exit while working fails the requests waiting, and the later ones", async () => {
    const worker = await ready();
    const waiting = worker.transcribe(new Float32Array(1), null);
    last().emit("exit", 1, null);
    await assert.rejects(waiting, { message: "dictation worker exited (1)" });
    await assert.rejects(worker.transcribe(new Float32Array(1), null), { message: "dictation worker exited (1)" });
});

test("worker: a process that can't start rejects with the reason", async () => {
    const started = startWorker("/repo/dictation", "/models/turbo", "es");
    last().emit("error", new Error("spawn ENOENT"));
    await assert.rejects(started, { message: "dictation worker spawn ENOENT" });
});

test("worker: not ready after 60 s, the start is given up and the worker killed", async () => {
    vi.useFakeTimers();
    const started = startWorker("/repo/dictation", "/models/turbo", "es");
    const outcome = started.then(() => "ready", err => err.message);
    vi.advanceTimersByTime(59_999);
    assert.equal(last().killed, 0);
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    assert.equal(await outcome, "dictation worker not ready after 60 s");
    assert.equal(last().killed, 1);
});

test("worker: once ready, the start's timer no longer runs", async () => {
    vi.useFakeTimers();
    const started = startWorker("/repo/dictation", "/models/turbo", "es");
    last().stdout.write('{"ready": true}\n');
    await vi.advanceTimersByTimeAsync(0);
    await started;
    vi.advanceTimersByTime(60_000);
    assert.equal(last().killed, 0);
});

test("worker: an exit or an error clears the start's timer", async () => {
    vi.useFakeTimers();
    for (const end of [child => child.emit("exit", 0, null), child => child.emit("error", new Error("x"))]) {
        const started = startWorker("/repo/dictation", "/models/turbo", "es").catch(() => {});
        end(last());
        await started;
        const kills = last().killed;
        vi.advanceTimersByTime(60_000);
        assert.equal(last().killed, kills);
    }
});

test("worker: close() kills it, and later requests are refused", async () => {
    const worker = await ready();
    worker.close();
    assert.equal(last().killed, 1);
    await assert.rejects(worker.transcribe(new Float32Array(1), null), { message: "dictation worker closed" });
    // The first failure stays the one reported.
    last().emit("exit", null, "SIGTERM");
    await assert.rejects(worker.transcribe(new Float32Array(1), null), { message: "dictation worker closed" });
});

test("worker: a write after it died kills it, and its exit reports why", async () => {
    await ready();
    last().stdin.emit("error", new Error("EPIPE"));
    assert.equal(last().killed, 1);
});

test("worker: of its stderr only the last 2000 characters stay, and the message shows their last line", async () => {
    const started = startWorker("/repo/dictation", "/models/turbo", "es");
    await say("stderr", `${"x".repeat(1990)}\nlast line here\n`);
    last().emit("exit", 1, null);
    await assert.rejects(started, { message: "dictation worker exited (1): last line here" });
    const long = startWorker("/repo/dictation", "/models/turbo", "es");
    await say("stderr", `${"a".repeat(10)}${"y".repeat(2000)}`);
    last().emit("exit", 1, null);
    await assert.rejects(long, { message: `dictation worker exited (1): ${"y".repeat(2000)}` });
});

test("worker: no stderr, or only blank lines, no colon", async () => {
    const started = startWorker("/repo/dictation", "/models/turbo", "es");
    last().emit("exit", 2, null);
    await assert.rejects(started, { message: "dictation worker exited (2)" });
    const blank = startWorker("/repo/dictation", "/models/turbo", "es");
    await say("stderr", "\n  \n");
    last().emit("exit", 2, null);
    await assert.rejects(blank, { message: "dictation worker exited (2)" });
});
