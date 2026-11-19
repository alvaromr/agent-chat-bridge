// Where the files are (scripts/bundle.mjs): the clone a test runs from, or, in the release's executable, the app's
// folder. Run with `pnpm test`.
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, test, vi } from "vitest";

import { appDataDir } from "../mod/src/platform.mts";

const STATE = join(appDataDir(process.platform, process.env, homedir()), "agent-chat-bridge");

afterEach(() => {
    vi.doUnmock("node:sea");
    vi.resetModules();
});

test("bundle: from a clone, the files are the clone's, and the state is the app's folder", async () => {
    const bundle = await import("../scripts/bundle.mjs");
    assert.equal(bundle.REPO, fileURLToPath(new URL("..", import.meta.url)));
    assert.equal(bundle.filesRoot(), bundle.REPO);
    assert.equal(bundle.STATE, STATE);
});

test("bundle: in the executable there is no clone, and the files are in the app's folder", async () => {
    vi.doMock("node:sea", () => ({ isSea: () => true }));
    const bundle = await import("../scripts/bundle.mjs");
    assert.equal(bundle.REPO, null);
    assert.equal(bundle.filesRoot(), STATE);
});
