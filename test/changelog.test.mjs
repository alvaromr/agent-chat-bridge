// The changelog step of a release (scripts/changelog.mjs). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { releaseChangelog } from "../scripts/changelog.mjs";

const HEAD = "# Changelog\n\nAll notable changes, in user terms.\n\n";
const OLDER = "## [0.1.0] - 2026-11-03\n\n### Added\n- The Corrector.\n";
const DISCORD = { app: "0.0.421", build: "668923", channel: "stable" };
const TESTED = "Tested with Discord 0.0.421 for macOS, stable web client build 668923.";
/** The changelog of a release, with the tested Discord. */
const release = (changelog, version, previous, date) => releaseChangelog(changelog, version, previous, date, DISCORD);

test("release: the unreleased entries move under the dated version, opened by the Discord tested, before the older ones", () => {
    const changelog = `${HEAD}## [Unreleased]\n\n### Fixed\n- A hang.\n\n${OLDER}`;
    assert.deepEqual(release(changelog, "0.2.0", "0.1.0", "2026-12-01"), {
        changelog: `${HEAD}## [Unreleased]\n\n## [0.2.0] - 2026-12-01\n\n${TESTED}\n\n### Fixed\n- A hang.\n\n${OLDER}`,
        notes: `${TESTED}\n\n### Fixed\n- A hang.`
    });
});

test("release: the first release, with no older section, ends the file", () => {
    const changelog = `${HEAD}## [Unreleased]\n\n### Added\n- The Corrector.\n`;
    assert.equal(release(changelog, "0.1.0", "0.0.0", "2026-11-03").changelog,
        `${HEAD}## [Unreleased]\n\n## [0.1.0] - 2026-11-03\n\n${TESTED}\n\n### Added\n- The Corrector.\n\n`);
});

test("release: the version must be x.y.z and come after the current one, in any of its parts", () => {
    const changelog = `${HEAD}## [Unreleased]\n\n- A change.\n`;
    for (const version of ["1.0", "v1.0.0", "1.0.0-beta", "1.0.0\n", " 1.0.0"]) {
        assert.throws(() => release(changelog, version, "0.1.0", "2026-12-01"), { message: `Not a version (x.y.z): ${version}` });
    }
    /** @type {[string, string][]} */
    const notAfter = [["0.1.0", "0.1.0"], ["0.1.0", "0.1.1"], ["0.1.9", "0.2.0"], ["0.9.9", "1.0.0"], ["0.9.0", "0.10.0"]];
    for (const [version, previous] of notAfter) {
        assert.throws(() => release(changelog, version, previous, "2026-12-01"),
            { message: `${version} does not come after ${previous}` });
    }
    /** @type {[string, string][]} */
    const after = [["0.1.1", "0.1.0"], ["0.2.0", "0.1.9"], ["1.0.0", "0.9.9"], ["0.10.0", "0.9.0"], ["10.0.0", "9.9.9"],
        ["0.1.10", "0.1.9"]];
    for (const [version, previous] of after) {
        assert.ok(release(changelog, version, previous, "2026-12-01").changelog.includes(`## [${version}] - 2026-12-01`));
    }
});

test("release: a changelog without unreleased entries has nothing to release", () => {
    for (const changelog of [`${HEAD}${OLDER}`, `${HEAD}### [Unreleased]\n\n- A change.\n`]) {
        assert.throws(() => release(changelog, "0.2.0", "0.1.0", "2026-12-01"),
            { message: "CHANGELOG.md has no [Unreleased] section" });
    }
    assert.throws(() => release(`${HEAD}## [Unreleased]\n\n${OLDER}`, "0.2.0", "0.1.0", "2026-12-01"),
        { message: "[Unreleased] in CHANGELOG.md is empty: nothing to release" });
    assert.throws(() => release(`${HEAD}## [Unreleased]\n  \n`, "0.2.0", "0.1.0", "2026-12-01"),
        { message: "[Unreleased] in CHANGELOG.md is empty: nothing to release" });
});
