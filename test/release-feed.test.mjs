// GitHub's releases as the executable reads them (scripts/release-feed.mjs), on a faked fetch: the latest release's
// tag, notes and files, a file's bytes, and how a failure shows. Run with `pnpm test`.
import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";

import { afterEach, beforeEach, test, vi } from "vitest";

import { download, latestRelease } from "../scripts/release-feed.mjs";

/** Each request: its URL and headers. @type {[string, any][]} */
let requests;
/** What GitHub answers. */
let answer;
beforeEach(() => {
    requests = [];
    vi.stubGlobal("fetch", async (url, init) => {
        requests.push([url, init.headers]);
        if (answer instanceof Error) throw answer;
        return answer;
    });
});
afterEach(() => void vi.unstubAllGlobals());
const logged = () => vi.spyOn(console, "log").mockImplementation(() => { });

test("release feed: the latest release is its tag, its notes and its files by name, asked of GitHub's API with a name", async () => {
    answer = Response.json({ tag_name: "v0.4.0", body: "### Added\n- x", assets: [{ name: "a", browser_download_url: "https://x/a" }] });
    assert.deepEqual(await latestRelease(), { tag: "v0.4.0", notes: "### Added\n- x", files: { a: "https://x/a" } });
    assert.deepEqual(requests, [["https://api.github.com/repos/alvaromr/agent-chat-bridge/releases/latest",
        { "User-Agent": "agent-chat-bridge", Accept: "application/vnd.github+json" }]]);
    answer = Response.json({ tag_name: "v0.4.0", body: null, assets: [] });
    assert.deepEqual(await latestRelease(), { tag: "v0.4.0", notes: "", files: {} }, "a release without notes has empty ones");
});

test("release feed: without an answer, or with an error status, there is no release, and only the log says why", async () => {
    const log = logged();
    answer = new Response("", { status: 403 });
    assert.equal(await latestRelease(), null);
    answer = new TypeError("fetch failed");
    assert.equal(await latestRelease(), null);
    assert.deepEqual(log.mock.calls, [["Releases not checked: GitHub answered 403"], ["Releases not checked: fetch failed"]]);
});

test("release key: an ed25519 public key, the half that checks the releases' signatures", async () => {
    const { RELEASE_KEY } = await import("../scripts/release-key.mjs");
    const key = createPublicKey(RELEASE_KEY);
    assert.deepEqual([key.type, key.asymmetricKeyType], ["public", "ed25519"]);
});

test("release feed: a file's bytes come with the client's name, and an error status fails saying which file", async () => {
    answer = new Response(new Uint8Array([1, 2, 3]));
    assert.deepEqual(await download("https://x/a"), new Uint8Array([1, 2, 3]));
    assert.deepEqual(requests, [["https://x/a", { "User-Agent": "agent-chat-bridge" }]]);
    answer = new Response("", { status: 404 });
    await assert.rejects(download("https://x/a"), { message: "GitHub answered 404 for https://x/a" });
});
