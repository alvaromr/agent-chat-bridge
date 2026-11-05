// Mutation testing of the code (`pnpm mutation`), outside the pre-commit hook: each mutant runs only the unit tests that
// cover it (vitest.config.mjs), and mutants that don't compile are discarded first. What stays out, and why:
// docs/decisions/coverage-io-scripts-and-worker.md.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
    // pnpm doesn't place the plugins next to Stryker, where it looks for them by default.
    plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
    testRunner: "vitest",
    checkers: ["typescript"],
    tsconfigFile: "tsconfig.json",
    // Also what the coverage counts; a `!` entry leaves files out of both.
    mutate: [
        "dictation/src/*.ts",
        "mod/src/**/*.{ts,tsx,mts}",
        "!mod/src/**/*.d.ts",
        "plugins/**/*.{ts,tsx}",
        "scripts/asar.mjs",
        "scripts/changelog.mjs",
        "scripts/acb.mjs"
    ],
    incremental: true,
    // Safety limits: few processes at once, and a mutant that loops is cut close to the suite's real time.
    concurrency: 2,
    timeoutMS: 2000,
    reporters: ["clear-text", "progress", "html"],
    // Zero survivors: how to treat one is in AGENTS.md (`pnpm mutation`).
    thresholds: { high: 100, low: 100, break: 100 }
};
