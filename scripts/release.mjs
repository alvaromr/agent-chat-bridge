// `pnpm release <x.y.z>`: the whole release from main, stopping at the first failure. It runs the gate, the audit, the
// mutation run and the Discord code check, installs and tests a fresh clone, then sets the version, dates the
// changelog with the Discord it was tested with, commits and tags, the tag carrying that section. Pushing and the
// GitHub release, made from the tag, stay with whoever releases.
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { discordVersion } from "../test/discord-cache.mjs";
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
    // The Discord whose cached code `pnpm check-discord` checks below, and the one the user ran it with.
    const { changelog, notes } = releaseChangelog(readFileSync("CHANGELOG.md", "utf8"), version, pkg.version, date, discordVersion());

    run("pnpm", ["check"]);
    // `run`: pnpm's own audit command would shadow the script, which also audits the dictation worker's packages.
    run("pnpm", ["run", "audit"]);
    run("pnpm", ["mutation", "--force"]);
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
    console.log(`Released ${version}: push it with \`git push --follow-tags\`, then publish its GitHub release with ` +
        `\`gh release create v${version} --verify-tag --notes-from-tag\`.`);
} catch (err) {
    // A failed command already printed its output; this says which step stopped the release.
    console.error(`Release stopped: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
}
