// `pnpm release <x.y.z>`: the whole release from main, stopping at the first failure. It runs the gate, the mutation
// run and the Discord code check, installs and tests a fresh clone, then sets the version, dates the changelog, commits
// and tags. Pushing stays with whoever releases: `git push --follow-tags`.
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { releaseChangelog } from "./changelog.mjs";

/** @param {string} command @param {string[]} args */
const output = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
/** @param {string} command @param {string[]} args @param {string} [cwd] */
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });

try {
    const version = process.argv[2] ?? "";
    if (output("git", ["branch", "--show-current"]) !== "main") throw new Error("a release is made from main");
    if (output("git", ["status", "--porcelain"])) throw new Error("the tree has uncommitted changes");
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const date = new Date().toISOString().slice(0, 10);
    const changelog = releaseChangelog(readFileSync("CHANGELOG.md", "utf8"), version, pkg.version, date);

    run("pnpm", ["check"]);
    run("pnpm", ["mutation", "--force"]);
    run("pnpm", ["check-discord"]);

    // As someone who clones it: only what is committed, installed from the lockfile.
    const clone = mkdtempSync(join(tmpdir(), "discord-mod-release-"));
    try {
        run("git", ["clone", "--quiet", "--no-hardlinks", ".", clone]);
        run("pnpm", ["install", "--frozen-lockfile"], clone);
        run("pnpm", ["build"], clone);
        run("pnpm", ["test"], clone);
    } finally {
        rmSync(clone, { recursive: true, force: true });
    }

    writeFileSync("package.json", JSON.stringify({ ...pkg, version }, null, 2) + "\n");
    writeFileSync("CHANGELOG.md", changelog);
    run("git", ["add", "package.json", "CHANGELOG.md"]);
    run("git", ["commit", "--quiet", "--message", `Release ${version}`]);
    run("git", ["tag", "--annotate", `v${version}`, "--message", version]);
    console.log(`Released ${version}: push it with \`git push --follow-tags\`.`);
} catch (err) {
    // A failed command already printed its output; this says which step stopped the release.
    console.error(`Release stopped: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
}
