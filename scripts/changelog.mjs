// The changelog step of a release (scripts/release.mjs). No I/O, so test/ loads it directly.

const VERSION = /^\d+\.\d+\.\d+$/;
const UNRELEASED = /^## \[Unreleased\]\n([\s\S]*?)(?=^## |(?![\s\S]))/m;

/** Zero-padded parts, so that comparing two keys as strings compares the versions. @param {string} version */
const key = version => version.split(".").map(part => part.padStart(9, "0")).join();

/**
 * Moves the entries under `[Unreleased]` in CHANGELOG.md to a section for `version`, dated, and leaves `[Unreleased]`
 * empty for the next changes.
 * @param {string} changelog
 * @param {string} version the new version, x.y.z
 * @param {string} previous the version in package.json
 * @param {string} date YYYY-MM-DD
 */
export function releaseChangelog(changelog, version, previous, date) {
    if (!VERSION.test(version)) throw new Error(`Not a version (x.y.z): ${version}`);
    if (key(version) <= key(previous)) throw new Error(`${version} does not come after ${previous}`);
    const section = UNRELEASED.exec(changelog);
    if (!section) throw new Error("CHANGELOG.md has no [Unreleased] section");
    const entries = /** @type {string} */ (section[1]).trim();
    if (!entries) throw new Error("[Unreleased] in CHANGELOG.md is empty: nothing to release");
    return changelog.replace(section[0], `## [Unreleased]\n\n## [${version}] - ${date}\n\n${entries}\n\n`);
}
