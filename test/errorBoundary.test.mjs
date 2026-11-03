// Regression tests of a plugin component's failure (mod/src/plugin-api/ErrorBoundary.tsx) on a fake Discord. Run with
// `pnpm test`.
import assert from "node:assert/strict";

import { afterEach, beforeEach, test, vi } from "vitest";

import { reset, showToast } from "./fake-discord.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

const { reportRenderFailure } = await import("../mod/src/plugin-api/ErrorBoundary.tsx");

beforeEach(() => {
    vi.useFakeTimers();
    reset();
});
afterEach(() => vi.useRealTimers());

test("a failing plugin button tells the user once per name, after the render, and logs every failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    const boom = new Error("boom");
    reportRenderFailure("Corrector", boom);
    reportRenderFailure("Corrector", boom);
    reportRenderFailure("Autorespuesta", boom);
    assert.equal(showToast.mock.calls.length, 0, "no toast inside React's render");
    await vi.runAllTimersAsync();
    assert.deepEqual(showToast.mock.calls, [
        [{ text: "Corrector no se pudo mostrar; el detalle está en la consola", variant: "critical" }],
        [{ text: "Autorespuesta no se pudo mostrar; el detalle está en la consola", variant: "critical" }]
    ]);
    assert.deepEqual(error.mock.calls, [
        ["[discord-mod] Corrector failed", boom], ["[discord-mod] Corrector failed", boom], ["[discord-mod] Autorespuesta failed", boom]
    ]);
});
