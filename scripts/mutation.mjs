// `pnpm mutation [--full]`: Stryker (stryker.config.mjs) at lower scheduling priority, incremental, so it re-tests
// only the mutants whose result a change since the last run can alter. Stryker sees changes in a mutant's own code and
// in its killing test; before it runs, this drops from its result the mutants whose tests or type-check reach any
// other change (scripts/mutation-scope.mjs): code and helpers they import, dependencies, configs. It runs the full set
// only when asked with `--full`, or when there is no previous result.
import { spawnSync } from "child_process";
import { existsSync, globSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { constants, setPriority } from "os";
import { dirname, relative, sep } from "path";
import { fileURLToPath } from "url";

import stryker from "../stryker.config.mjs";
import { assumedPrevious, changedInputs, inputGraph, inputValue, withoutStale } from "./mutation-scope.mjs";

/**
 * The parts of vitest.config.mjs read here. Loaded by URL: a static import brings vitest's types into the type-check
 * of every plain JS file, where they clash with the tests that redefine `process.platform`.
 * @type {{ resolve: { alias: { find: RegExp, replacement: string }[] }, oxc: { jsxInject: string },
 *   test: { include: string[], setupFiles: string[] } }}
 */
const vitest = (await import(new URL("../vitest.config.mjs", import.meta.url).href)).default;

// Stryker's default `incrementalFile`, rewritten at the end of every run that finishes.
const RESULT = "reports/stryker-incremental.json";
// The inputs of the last finished run: what the next run compares against. In node_modules/, which the secret scan
// skips: its hashes, next to names like a key's, look like secrets to it. A reinstall that removes it leaves the
// files' dates to compare against.
const INPUTS = "node_modules/.cache/mutation-inputs.json";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const args = process.argv.slice(2);
if (args.some(arg => arg !== "--full")) {
    console.error("Usage: pnpm mutation [--full]");
    process.exit(2);
}

/** @param {string} path */
const slashes = path => path.split(sep).join("/");
/** @param {string} file */
const read = file => existsSync(file) && statSync(file).isFile() ? readFileSync(file, "utf8") : undefined;
const mutate = /** @type {string[]} */ (stryker.mutate);
const graph = inputGraph({
    tests: globSync(vitest.test.include).map(slashes),
    mutated: globSync(mutate.filter(glob => !glob.startsWith("!")), { exclude: mutate.filter(glob => glob.startsWith("!")).map(glob => glob.slice(1)) }).map(slashes),
    setupFiles: vitest.test.setupFiles,
    aliases: vitest.resolve.alias.map(({ find, replacement }) => ({ find, replacement: `${slashes(relative(ROOT, replacement))}/` })),
    jsxInject: vitest.oxc.jsxInject,
    tsconfig: /** @type {string} */ (stryker.tsconfigFile),
    typePackages: readdirSync("node_modules/@types").map(name => `@types/${name}`),
    read
});
const nodeModules = {
    /** @param {string} path */
    realpath: path => existsSync(path) ? slashes(realpathSync(path)) : undefined,
    /** @param {string} path */
    readdir: path => readdirSync(path)
};
const project = { read, configs: { vitest, stryker }, nodeModules };
const inputs = new Set([...graph.tests.values(), ...graph.compile.values()].flatMap(reached => [...reached]));
const current = Object.fromEntries([...inputs].sort().map(input => [input, inputValue(input, project)]));

/** Why this run must be a full one, or undefined when the incremental result holds once its stale mutants are dropped. */
function fullReason() {
    if (args.includes("--full")) return "asked with --full";
    if (!existsSync(RESULT)) return `no previous result (${RESULT})`;
    return undefined;
}

const reason = fullReason();
if (reason) console.log(`Mutation: full run, ${reason}.`);
else {
    const last = statSync(RESULT).mtimeMs;
    const previous = existsSync(INPUTS) ? JSON.parse(readFileSync(INPUTS, "utf8"))
        : assumedPrevious(current, file => !existsSync(file) || statSync(file).mtimeMs > last);
    const changed = changedInputs(previous, current);
    const { report, retested } = withoutStale(JSON.parse(readFileSync(RESULT, "utf8")), graph, changed);
    if (retested) writeFileSync(RESULT, JSON.stringify(report));
    console.log(changed.size
        ? `Mutation: incremental run; ${retested} mutants re-tested besides what Stryker sees, for changes in: ${[...changed].join(", ")}.`
        : "Mutation: incremental run.");
}
const before = existsSync(RESULT) ? statSync(RESULT).mtimeMs : -1;
// Below normal, inherited by Stryker and its test runners, so the machine stays usable while it runs.
setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
const { status, error } = spawnSync("stryker", ["run", ...reason ? ["--force"] : []], { stdio: "inherit", shell: process.platform === "win32" });
if (error) throw error;
// Only a run that finished rewrote the result; its inputs are the ones it started from.
if (existsSync(RESULT) && statSync(RESULT).mtimeMs > before) {
    mkdirSync(dirname(INPUTS), { recursive: true });
    writeFileSync(INPUTS, `${JSON.stringify(current, null, 4)}\n`);
}
process.exit(status ?? 1);
