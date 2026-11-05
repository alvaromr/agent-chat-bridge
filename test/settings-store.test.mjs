// Regression test of a plugin's settings store (mod/src/plugin-api/settings.ts): it reads like a plain object, so
// destructuring it with a rest, as Dictation does, keeps every setting. Run with `pnpm test`.
import assert from "node:assert/strict";

import { test, vi } from "vitest";

// The renderer reads the saved settings through `window` when it loads: one value differs from its default.
vi.hoisted(() => {
    /** @type {any} */ (globalThis).window = Object.assign(globalThis, {
        AgentChatBridgeNative: { getSettings: () => ({ Test: { b: true } }) }
    });
});

const { definePluginSettings } = await import("../mod/src/plugin-api/settings.ts");

test("settings: the store spreads with every setting, saved or default", () => {
    // The store doesn't read the type, and OptionType is a const enum plain JS can't import: 0 for every setting.
    const settings = definePluginSettings({
        a: { type: 0, description: "a", default: "x" },
        b: { type: 0, description: "b", default: false },
        c: { type: 0, description: "c", default: true }
    });
    settings.pluginName = "Test";
    const { a, ...rest } = settings.store;
    assert.equal(a, "x");
    assert.deepEqual(rest, { b: true, c: true });
    assert.deepEqual(Object.keys(settings.store), ["a", "b", "c"]);
    assert.equal("d" in settings.store, false);
});
