// `pnpm mutation [--full]`: Stryker (stryker.config.mjs) at lower scheduling priority, incremental by default, so it
// re-tests only the mutants whose code or covering tests changed since the last run. It runs the full set only when
// asked with `--full`, or when its incremental result can't be trusted, and then says why: there is no previous
// result, or something every mutant depends on and the incremental run can't see changed after it (UNSEEN).
import { spawnSync } from "child_process";
import { existsSync, globSync, statSync } from "fs";
import { constants, setPriority } from "os";

/** What incremental runs can't see change: the shared test helpers, the dependencies and the test and mutation configs. */
const UNSEEN = ["test/fake-*.mjs", "test/dom.mjs", "test/app-folders.mjs", "test/setup.mjs", "dictation/test/posix-path.mjs",
    "pnpm-lock.yaml", "vitest.config.mjs", "stryker.config.mjs"];
// Stryker's default `incrementalFile`, rewritten at the end of every run that finishes.
const RESULT = "reports/stryker-incremental.json";

const args = process.argv.slice(2);
if (args.some(arg => arg !== "--full")) {
    console.error("Usage: pnpm mutation [--full]");
    process.exit(2);
}

/** Why this run must be a full one, or undefined when the incremental result still holds. */
function fullReason() {
    if (args.includes("--full")) return "asked with --full";
    if (!existsSync(RESULT)) return `no previous result (${RESULT})`;
    const last = statSync(RESULT).mtimeMs;
    const changed = UNSEEN.flatMap(pattern => globSync(pattern)).filter(file => statSync(file).mtimeMs > last);
    return changed.length ? `changed since the last run, unseen by incremental runs: ${changed.join(", ")}` : undefined;
}

const reason = fullReason();
console.log(reason ? `Mutation: full run, ${reason}.` : "Mutation: incremental run.");
// Below normal, inherited by Stryker and its test runners, so the machine stays usable while it runs.
setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
const { status, error } = spawnSync("stryker", ["run", ...reason ? ["--force"] : []], { stdio: "inherit", shell: process.platform === "win32" });
if (error) throw error;
process.exit(status ?? 1);
