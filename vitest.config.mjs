// The unit suite (`pnpm test`, and `pnpm mutation` through Stryker), with 100 % coverage: the code that touches
// Discord runs on a fake Discord (test/fake-discord.mjs), Electron's and the system's sides on mocks. test/live.mjs and
// test/discord-code.mjs stay on `node --test`, so neither run can reach Discord.
import { readFile } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

import stryker from "./stryker.config.mjs";

/** CSS files as their text, as mod/build.mjs loads them; under an id of its own, so Vite's CSS handling leaves them. */
const PREFIX = "\0css-text:";
const cssAsText = {
    name: "css-as-text",
    enforce: /** @type {const} */ ("pre"),
    resolveId: (source, importer) => source.endsWith(".css") && importer ? `${PREFIX}${resolve(dirname(importer), source)}.mjs` : null,
    load: async id => id.startsWith(PREFIX) ? `export default ${JSON.stringify(await readFile(id.slice(PREFIX.length, -".mjs".length), "utf8"))};` : null
};

export default defineConfig({
    plugins: [cssAsText],
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
            // The same files Stryker mutates.
            include: /** @type {string[]} */ (stryker.mutate).filter(glob => !glob.startsWith("!")),
            exclude: /** @type {string[]} */ (stryker.mutate).filter(glob => glob.startsWith("!")).map(glob => glob.slice(1)),
            thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }
        }
    }
});
