// The unit suite (`pnpm test`, and `pnpm mutation` through Stryker): the pure modules, with 100 % coverage, and the
// regression tests of fixes in Discord-side code, which run on a fake Discord (test/fake-discord.mjs) and don't count
// for coverage. test/smoke.mjs and test/discord-code.mjs stay on `node --test`, so neither run can reach Discord.
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

import stryker from "./stryker.config.mjs";

export default defineConfig({
    // As mod/build.mjs builds the renderer: `@plugin-api/…`, and JSX on Discord's React through plugin-api/jsx.ts.
    resolve: { alias: [{ find: /^@plugin-api\//, replacement: fileURLToPath(new URL("mod/src/plugin-api/", import.meta.url)) }] },
    oxc: {
        jsx: { runtime: "classic", pragma: "AgentChatBridgeCreateElement", pragmaFrag: "AgentChatBridgeFragment" },
        jsxInject: 'import { AgentChatBridgeCreateElement, AgentChatBridgeFragment } from "@plugin-api/jsx";'
    },
    test: {
        include: ["test/*.test.mjs", "dictation/test/*.test.mjs"],
        setupFiles: ["test/setup.mjs"],
        // A zone with daylight saving time, so local-date tests give the same result on every machine.
        env: { TZ: "Europe/Madrid" },
        restoreMocks: true,
        coverage: {
            provider: "v8",
            // The pure modules: the same list Stryker mutates.
            include: /** @type {string[]} */ (stryker.mutate),
            thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }
        }
    }
});
