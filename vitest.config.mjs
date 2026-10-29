// The unit suite (`pnpm test`, and `pnpm mutation` through Stryker): the pure modules, with 100 % coverage of the files
// it loads. test/smoke.mjs and test/discord-code.mjs stay on `node --test`, so neither run can reach Discord.
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/*.test.mjs"],
        setupFiles: ["test/setup.mjs"],
        // A zone with daylight saving time, so local-date tests give the same result on every machine.
        env: { TZ: "Europe/Madrid" },
        restoreMocks: true,
        coverage: {
            provider: "v8",
            thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }
        }
    }
});
