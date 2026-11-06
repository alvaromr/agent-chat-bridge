// Where the dictation worker can run (dictation/src/platform.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { canRunWorker } from "../src/platform.ts";

test("platform: the worker runs on Apple Silicon Macs from macOS 14 (Darwin 23) on", () => {
    assert.equal(canRunWorker("darwin", "arm64", "23.0.0"), true);
    assert.equal(canRunWorker("darwin", "arm64", "25.5.0"), true);
    assert.equal(canRunWorker("darwin", "arm64", "22.6.0"), false, "macOS 13");
    assert.equal(canRunWorker("darwin", "x64", "25.5.0"), false, "an Intel Mac");
    assert.equal(canRunWorker("linux", "arm64", "25.5.0"), false, "not a Mac");
});
