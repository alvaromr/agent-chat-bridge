// The models on disk (dictation/src/models.ts), on a fake Hugging Face cache in a temporary folder.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, test } from "vitest";

import { findModels, hubDir } from "../src/models.ts";

/** @type {string} */
let hub;
beforeEach(() => {
    hub = mkdtempSync(join(tmpdir(), "dictation-hub-"));
});
afterEach(() => rmSync(hub, { recursive: true, force: true }));

/** A snapshot with these files; `current` also names it in refs/main, as a download does. */
function snapshot(dir, rev, files, current = true) {
    const path = join(hub, dir, "snapshots", rev);
    mkdirSync(path, { recursive: true });
    for (const f of files) writeFileSync(join(path, f), "");
    if (current) {
        mkdirSync(join(hub, dir, "refs"), { recursive: true });
        writeFileSync(join(hub, dir, "refs/main"), `${rev}\n`);
    }
    return path;
}

test("models: the cache follows Hugging Face's own variables", () => {
    assert.equal(hubDir({}, "/home/u"), "/home/u/.cache/huggingface/hub");
    assert.equal(hubDir({ HF_HOME: "/hf" }, "/home/u"), "/hf/hub");
    assert.equal(hubDir({ HF_HOME: "/hf", HF_HUB_CACHE: "/cache" }, "/home/u"), "/cache");
});

test("models: whisper models whose current snapshot holds the config and the weights, sorted by id", () => {
    const turbo = snapshot("models--mlx-community--whisper-large-v3-turbo", "a1", ["config.json", "weights.safetensors"]);
    const small = snapshot("models--someone--Whisper-small-es", "b1", ["config.json", "weights.npz"]);
    // By bytes «Zeta» goes before «alpha»; by id, after.
    const zeta = snapshot("models--Zeta--whisper-x", "c1", ["config.json", "weights.npz"]);
    assert.deepEqual(findModels(hub), [
        { id: "mlx-community/whisper-large-v3-turbo", path: turbo },
        { id: "someone/Whisper-small-es", path: small },
        { id: "Zeta/whisper-x", path: zeta }
    ]);
});

test("models: an incomplete download, another kind of model or a stray folder is left out", () => {
    snapshot("models--mlx-community--whisper-large-v3-mlx", "a1", ["config.json"]);
    snapshot("models--mlx-community--whisper-tiny", "a1", ["weights.npz"]);
    snapshot("models--adefossez--HTDemucs", "a1", ["config.json", "weights.safetensors"]);
    snapshot("datasets--x--whisper-data", "a1", ["config.json", "weights.safetensors"]);
    snapshot("old-models--x--whisper-y", "a1", ["config.json", "weights.safetensors"]);
    snapshot("models--x--whisper-without-ref", "a1", ["config.json", "weights.safetensors"], false);
    mkdirSync(join(hub, ".locks"));
    assert.deepEqual(findModels(hub), []);
});

test("models: of several snapshots, the one refs/main names", () => {
    snapshot("models--mlx-community--whisper-turbo", "a1", ["config.json", "weights.npz"], false);
    const b = snapshot("models--mlx-community--whisper-turbo", "b2", ["config.json", "weights.npz"]);
    snapshot("models--mlx-community--whisper-turbo", "c3", ["config.json", "weights.npz"], false);
    assert.deepEqual(findModels(hub), [{ id: "mlx-community/whisper-turbo", path: b }]);
});

test("models: no cache at all is no models", () => {
    assert.deepEqual(findModels(join(hub, "missing")), []);
});
