// The real worker (dictation/src/worker.ts and worker/worker.py), on a phrase that macOS's `say` speaks: the I/O that
// the unit tests fake. Run with `pnpm smoke-dictation`; it needs the worker installed and a Whisper model on disk.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { findModels, hubDir } from "../src/models.ts";
import { startWorker } from "../src/worker.ts";

const DIR = fileURLToPath(new URL("..", import.meta.url));
const MODEL = "mlx-community/whisper-large-v3-turbo";

/** A phrase spoken by `say`, as 16 kHz mono floats. */
function spoken(text) {
    const dir = mkdtempSync(join(tmpdir(), "dictation-smoke-"));
    try {
        const file = join(dir, "phrase.wav");
        execFileSync("say", ["-v", "Mónica", "-o", file, "--file-format=WAVE", "--data-format=LEF32@16000", text]);
        const wav = readFileSync(file);
        const data = wav.indexOf("data") + 8;
        return new Float32Array(wav.buffer.slice(wav.byteOffset + data, wav.byteOffset + wav.length - (wav.length - data) % 4));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test("worker: transcribes a spoken phrase, with and without a prompt, then closes", async () => {
    const model = findModels(hubDir(process.env, homedir())).find(m => m.id === MODEL);
    assert.ok(model, `${MODEL} is not downloaded`);
    const worker = await startWorker(DIR, model.path, "es");
    try {
        const samples = spoken("Hola, esto es una prueba de dictado.");
        assert.match(await worker.transcribe(samples, null), /prueba de dictado/i);
        assert.match(await worker.transcribe(samples, "Hablamos de git y Claude Code."), /prueba de dictado/i);
    } finally {
        worker.close();
    }
    await assert.rejects(worker.transcribe(new Float32Array(16), null), /dictation worker closed/);
});

test("worker: a worker that can't start says why", async () => {
    await assert.rejects(startWorker(DIR, join(tmpdir(), "no-such-model"), "es"), /dictation worker exited/);
});
