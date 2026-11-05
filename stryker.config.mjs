// Mutation testing of the pure modules (`pnpm mutation`), outside the pre-commit hook: each mutant runs only the unit
// tests that cover it (vitest.config.mjs), and mutants that don't compile are discarded first.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
    // pnpm doesn't place the plugins next to Stryker, where it looks for them by default.
    plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
    testRunner: "vitest",
    checkers: ["typescript"],
    tsconfigFile: "tsconfig.json",
    mutate: [
        "dictation/src/engine.ts",
        "dictation/src/models.ts",
        "dictation/src/protocol.ts",
        "dictation/src/segmenter.ts",
        "dictation/src/style.ts",
        "dictation/src/vocabulary.ts",
        "dictation/src/worker.ts",
        "mod/src/attachments.ts",
        "mod/src/ipc.ts",
        "mod/src/limits.mts",
        "mod/src/settingsFile.ts",
        "mod/src/validate.ts",
        "mod/src/plugin-api/wait.ts",
        "mod/src/renderer/dedupe.ts",
        "mod/src/renderer/format.ts",
        "mod/src/renderer/match.ts",
        "mod/src/renderer/rateLimit.ts",
        "mod/src/renderer/regex.ts",
        "plugins/autorespuesta/transcript.ts",
        "plugins/corrector/list.ts",
        "plugins/corrector/text.ts",
        "plugins/dictation/space.ts",
        "plugins/dictation/text.ts",
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
