// `pnpm release <x.y.z>`: the whole release from main, stopping at the first failure. It runs the gate, the audit, the
// mutation run (a full one only when what incremental runs can't see changed since the last release) and the Discord
// code check, installs and tests a fresh clone, this system's executable included, then
// sets the version, dates the changelog with the Discord it was tested with, commits and tags, the tag carrying that
// section. Pushing stays with whoever releases; the tag's push starts the release workflow
// (.github/workflows/release.yml), which builds, signs and publishes the executables.
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { executableName } from "./bundle.mjs";
import { releaseChangelog } from "./changelog.mjs";
import { discordVersion } from "./check-discord/cache.mjs";

/**
 * What incremental mutation can't see change (AGENTS.md, `pnpm mutation`): the shared test helpers, the dependencies
 * and the test and mutation configs. With any of it changed since the last release, only a full run counts.
 */
const MUTATION_UNSEEN = ["test/fake-*.mjs", "test/dom.mjs", "test/app-folders.mjs", "test/setup.mjs", "dictation/test/posix-path.mjs",
    "pnpm-lock.yaml", "vitest.config.mjs", "stryker.config.mjs"];

/** @param {string} command @param {string[]} args */
const output = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();

/** Whether the mutation run must be a full one: something it can't see changed since `tag`, or there is no such tag. */
function fullMutation(/** @type {string} */ tag) {
    try {
        return Boolean(output("git", ["diff", "--name-only", tag, "HEAD", "--", ...MUTATION_UNSEEN]));
    } catch {
        return true; // no previous release to compare with
    }
}
/** @param {string} command @param {string[]} args @param {string} [cwd] */
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });

try {
    const version = process.argv[2] ?? "";
    if (output("git", ["branch", "--show-current"]) !== "main") throw new Error("a release is made from main");
    if (output("git", ["status", "--porcelain"])) throw new Error("the tree has uncommitted changes");
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const date = new Date().toISOString().slice(0, 10);
    // The Discord whose cached code `pnpm check-discord` checks below, and the one the user ran it with.
    const { changelog, notes } = releaseChangelog(readFileSync("CHANGELOG.md", "utf8"), version, pkg.version, date, discordVersion());

    run("pnpm", ["check"]);
    // `run`: pnpm's own audit command would shadow the script, which also audits the dictation worker's packages.
    run("pnpm", ["run", "audit"]);
    run("pnpm", ["mutation", ...fullMutation(`v${pkg.version}`) ? ["--force"] : []]);
    run("pnpm", ["check-discord"]);

    // As someone who clones it: only what is committed, installed from the lockfile.
    const clone = mkdtempSync(join(tmpdir(), "agent-chat-bridge-release-"));
    try {
        run("git", ["clone", "--quiet", "--no-hardlinks", ".", clone]);
        run("pnpm", ["install", "--frozen-lockfile"], clone);
        run("uv", ["sync", "--frozen", "--project", "dictation/worker"], clone);
        run("pnpm", ["build"], clone);
        run("pnpm", ["test"], clone);
        run("pnpm", ["smoke-dictation"], clone);
        // This system's executable builds and starts; the workflow builds and starts each system's.
        run("pnpm", ["build-executable", `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`], clone);
        const started = output(join(clone, "dist", executableName(process.platform, process.arch)), ["--version"]);
        if (started !== pkg.version) throw new Error(`the executable says it is ${started}, not ${pkg.version}`);
    } finally {
        rmSync(clone, { recursive: true, force: true });
    }

    writeFileSync("package.json", JSON.stringify({ ...pkg, version }, null, 2) + "\n");
    // pnpm checks the install against package.json before every script, the pre-push hook's included, and a new
    // version counts as a change: refresh it from the lockfile, which the version doesn't touch.
    run("pnpm", ["install", "--frozen-lockfile", "--offline"]);
    writeFileSync("CHANGELOG.md", changelog);
    run("git", ["add", "package.json", "CHANGELOG.md"]);
    run("git", ["commit", "--quiet", "--message", `Release ${version}`]);
    run("git", ["tag", "--annotate", `v${version}`, "--cleanup=verbatim", "--message", `agent-chat-bridge ${version}\n\n${notes}`]);
    console.log(`Released ${version}: push it with \`git push --follow-tags\`; the release workflow then publishes its `
        + "executables on GitHub (gh run watch).");
} catch (err) {
    // A failed command already printed its output; this says which step stopped the release.
    console.error(`Release stopped: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
}
