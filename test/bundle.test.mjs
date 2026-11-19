// Where the files are (scripts/bundle.mjs): the clone a test runs from, or, in the release's executable, the app's
// folder, into which it unpacks the files it carries. Run with `pnpm test`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, test, vi } from "vitest";

import { appDataDir } from "../mod/src/platform.mts";

const fake = vi.hoisted(() => ({ home: "", assets: /** @type {Record<string, string>} */ ({}) }));
vi.mock("node:os", async original => ({ ...(/** @type {any} */ (await original())), homedir: () => fake.home }));

/** The release's executable, carrying `files` by their paths in the repo. */
const asExecutable = (/** @type {Record<string, string>} */ files) => {
    fake.assets = { "files.json": JSON.stringify(Object.keys(files)), ...files };
    vi.doMock("node:sea", () => ({
        isSea: () => true,
        getAsset: (key, encoding) => {
            if (!(key in fake.assets)) throw new Error(`no asset ${key}`);
            return encoding ? fake.assets[key] : new TextEncoder().encode(fake.assets[key]).buffer;
        }
    }));
};
const state = () => join(appDataDir(process.platform, process.env, fake.home), "agent-chat-bridge");

beforeEach(() => void (fake.home = mkdtempSync(join(tmpdir(), "bundle-"))));
afterEach(() => {
    vi.doUnmock("node:sea");
    vi.resetModules();
    rmSync(fake.home, { recursive: true, force: true });
});

test("bundle: from a clone, the files are the clone's, the patch its mod/dist/main.js, and the state the app's folder", async () => {
    const bundle = await import("../scripts/bundle.mjs");
    const repo = fileURLToPath(new URL("..", import.meta.url));
    assert.deepEqual([bundle.INSTALLED, bundle.REPO, bundle.filesRoot(), bundle.STATE], [false, repo, repo, state()]);
    assert.equal(bundle.modMain(), join(repo, "mod", "dist", "main.js"));
});

test("bundle: the executable has no clone; its files, the patch included, are in the app's folder", async () => {
    asExecutable({});
    const bundle = await import("../scripts/bundle.mjs");
    assert.deepEqual([bundle.INSTALLED, bundle.REPO, bundle.filesRoot()], [true, null, state()]);
    assert.equal(bundle.modMain(), join(state(), "mod", "dist", "main.js"));
});

test("bundle: unpack writes what the executable carries, replacing an older version's files and leaving the rest", async () => {
    mkdirSync(join(state(), "plugins", "gone"), { recursive: true });
    writeFileSync(join(state(), "plugins", "gone", "old.ts"), "");
    writeFileSync(join(state(), "settings.json"), "{}");
    asExecutable({ "mod/dist/main.js": "main", "skills/agent-chat-bridge/SKILL.md": "skill" });
    (await import("../scripts/bundle.mjs")).unpack();
    assert.equal(readFileSync(join(state(), "mod", "dist", "main.js"), "utf8"), "main");
    assert.equal(readFileSync(join(state(), "skills", "agent-chat-bridge", "SKILL.md"), "utf8"), "skill");
    assert.equal(existsSync(join(state(), "plugins")), false, "a folder the new version doesn't carry goes");
    assert.equal(readFileSync(join(state(), "settings.json"), "utf8"), "{}", "the settings stay");
});

test("bundle: unpack refuses a file outside the folders it owns, or one that climbs out of them, before it removes any", async () => {
    mkdirSync(join(state(), "mod"), { recursive: true });
    for (const file of ["settings.json", "mod/../../x", "../x"]) {
        asExecutable({ "mod/dist/main.js": "main", [file]: "" });
        await assert.rejects(async () => (await import("../scripts/bundle.mjs")).unpack(), { message: `Unexpected file in the executable: ${file}` });
        vi.resetModules();
    }
    assert.equal(existsSync(join(state(), "mod")), true);
    assert.equal(existsSync(join(state(), "mod", "dist")), false);
});
