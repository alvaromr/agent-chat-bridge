// Starts the Python worker (dictation/worker/worker.py) as a Transcriber, without network: macOS's sandbox denies it
// every connection, and Hugging Face is told to stay offline.
import { spawn } from "child_process";
import { realpathSync } from "fs";
import { homedir, tmpdir } from "os";
import { dirname, join } from "path";

// With their extensions, so plain Node runs these files too, as outside this repo it would.
import type { Transcriber } from "./engine.ts";
import { encodeRequest, lineSplitter, parseAnswer } from "./protocol.ts";

/**
 * macOS's sandbox profile: no network, and writes only to the devices and the user's own temporary folder (`USER`,
 * the parent of TMPDIR, which also holds the cache Metal compiles its shaders into). So a package can't leave a file
 * that something outside the sandbox runs later, such as a shell's startup file.
 */
const SANDBOX = `(version 1)(allow default)(deny network*)
(deny file-write*)(allow file-write* (subpath "/dev") (subpath (param "USER")))`;
/** Loading a model takes ~2 s; the first time after an install, ~20 s. */
const READY_MS = 60_000;
/** What stays of its stderr for an error message: Python's traceback, which holds code, never the audio or text. */
const STDERR_KEEP = 2000;

export interface Worker extends Transcriber {
    close(): void;
}

/** The worker's Python in the dictation/ folder, there once its packages are installed (README, «Install»). */
export const workerPython = (dir: string) => join(dir, "worker/.venv/bin/python");

/**
 * Resolves once the model is loaded. `dir` is the dictation/ folder, which a bundler can't know from this file.
 * Answers come back in the order of the requests: the worker handles one at a time.
 */
export function startWorker(dir: string, modelPath: string, language: string): Promise<Worker> {
    const python = workerPython(dir), script = join(dir, "worker/worker.py");
    // The sandbox matches real paths, and TMPDIR goes through the /var link.
    const user = dirname(realpathSync(tmpdir()));
    const child = spawn("/usr/bin/sandbox-exec", ["-D", `USER=${user}`, "-p", SANDBOX, python, "-I", script, modelPath, language], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { HOME: homedir(), PATH: "/usr/bin:/bin", TMPDIR: tmpdir(), HF_HUB_OFFLINE: "1" }
    });
    const pending: { resolve(text: string): void; reject(e: Error): void; }[] = [];
    let stderr = "", failed: Error | null = null;
    const fail = (why: string) => {
        const lastLine = stderr.slice(stderr.trimEnd().lastIndexOf("\n") + 1).trim();
        failed ??= new Error(`dictation worker ${why}${lastLine ? `: ${lastLine}` : ""}`);
        child.kill();
        for (const p of pending.splice(0)) p.reject(failed);
        return failed;
    };

    const worker: Worker = {
        transcribe: (samples, prompt) => new Promise((resolve, reject) => {
            if (failed) return reject(failed);
            pending.push({ resolve, reject });
            child.stdin.write(encodeRequest(samples, prompt));
        }),
        close: () => fail("closed")
    };

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(fail(`not ready after ${READY_MS / 1000} s`)), READY_MS);
        const split = lineSplitter();
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            try {
                for (const line of split(chunk)) {
                    const answer = parseAnswer(line);
                    if ("ready" in answer) {
                        clearTimeout(timer);
                        resolve(worker);
                        continue;
                    }
                    const request = pending.shift();
                    if (!request) throw new Error("the worker answered a request it was not sent");
                    request.resolve(answer.text);
                }
            } catch (err) {
                // Everything thrown above is an Error: JSON.parse's SyntaxError, or the protocol's own.
                reject(fail((err as Error).message));
            }
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            stderr = (stderr + chunk).slice(-STDERR_KEEP);
        });
        // A write after the worker died: its exit, just below, already reports why.
        child.stdin.on("error", () => child.kill());
        child.on("error", err => {
            clearTimeout(timer);
            reject(fail(err.message));
        });
        child.on("exit", (code, signal) => {
            clearTimeout(timer);
            reject(fail(`exited (${signal ?? code})`));
        });
    });
}
