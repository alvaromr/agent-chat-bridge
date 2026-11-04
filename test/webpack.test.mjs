// Regression tests of the patching of Discord's modules (mod/src/renderer/webpack.ts), on module factories made up
// here. Run with `pnpm test`.
import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { patches, wrapFactory } from "../mod/src/renderer/webpack.ts";

/** Runs a made-up module, patched by one new patch whose replacement is `replace`, as Discord would run it. */
function runPatched(name, replace) {
    const patch = { name, find: `"${name}"`, match: new RegExp(`"${name}"`), replace };
    patches.push(patch);
    const modules = { [name]: new Function(`return "${name}";`) };
    const result = wrapFactory(modules, name, modules[name])();
    return { patch, result };
}

test("a patch that applies and runs is shown as applied", () => {
    vi.spyOn(console, "log").mockImplementation(() => { });
    const { patch, result } = runPatched("works", '"patched"');
    assert.equal(result, "patched");
    assert.equal(patch.status, "ok");
});

test("a patched module that fails falls back to the original, and its patch is shown as failed", () => {
    vi.spyOn(console, "log").mockImplementation(() => { });
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    const { patch, result } = runPatched("breaks", "(() => { throw new Error(\"boom\"); })()");
    assert.equal(result, "breaks", "the original module ran");
    assert.equal(patch.status, "failed");
    assert.equal(error.mock.calls[0]?.[0], "[agent-chat-bridge] A patched module failed; using the original, without breaks");
});
