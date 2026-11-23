// `pnpm build-executable [<target>...]`: the release's single executable for each system (all by default), into dist/.
// It bundles scripts/executable.mjs with esbuild, puts it with the files it carries (scripts/bundle.mjs) into Node's
// official binary for the target as a single executable application (node --build-sea), and signs the macOS ones
// locally, without which macOS won't run them. The macOS one for Apple Silicon also carries Dictation's worker and
// uv. Node's and uv's archives are checked against the SHA-256 pinned here, from nodejs.org's SHASUMS256.txt and
// astral-sh/uv's release. Only I/O, checked by running it (docs/decisions/coverage-io-scripts-and-worker.md).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { executableName, MANIFEST } from "./bundle.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const CACHE = join(ROOT, "node_modules", ".cache", "agent-chat-bridge-node");
const NODE_VERSION = "26.13.1";

/** Node's official archive for each target, its SHA-256, and where its binary is inside. */
const TARGETS = {
    "darwin-arm64": { archive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, sha256: "aec2514ea1ceb2ba52455e9ec65986f6749a06dd759e5db2a72e6889668c9735", binary: "bin/node" },
    "darwin-x64": { archive: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, sha256: "82bb96078a24ca50b9c9a38f2379e6be6d87171fcd400fc14c8934b3bce96e2f", binary: "bin/node" },
    "linux-x64": { archive: `node-v${NODE_VERSION}-linux-x64.tar.xz`, sha256: "5c063e46bab0fbc1c17cc445d7ff129cbdcd0471be6ed83b6ab864f8143bc864", binary: "bin/node" },
    "win-x64": { archive: `node-v${NODE_VERSION}-win-x64.zip`, sha256: "e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7", binary: "node.exe" }
};
/** @typedef {keyof typeof TARGETS} Target */

/**
 * Dictation's uv for the one executable that carries Dictation, the macOS one for Apple Silicon: the version
 * dictation/worker/pyproject.toml requires, pinned by the SHA-256 of astral-sh/uv's release.
 */
const UV_VERSION = "0.13.8";
const UV = {
    target: "darwin-arm64",
    archive: "uv-aarch64-apple-darwin.tar.gz",
    sha256: "6b71028a6b904f2ae3340ef52e595512de807d06c0a20eaef2f692581b246558",
    binary: "uv-aarch64-apple-darwin/uv"
};

/** What every executable carries besides its script: the patch, the skill, and the sources and styles the Discord check reads. */
const CARRIED = [
    ...["main", "preload", "renderer"].map(name => `mod/dist/${name}.js`),
    ...trackedFiles(["mod/src", "plugins"]).filter(file => /\.(ts|tsx|mts|css)$/.test(file) && !file.endsWith(".d.ts")),
    ...trackedFiles(["skills/agent-chat-bridge"])
];
/** What the one with Dictation carries too: its worker, which its uv installs. */
const DICTATION = trackedFiles(["dictation/worker"]);

function trackedFiles(/** @type {string[]} */ dirs) {
    return execFileSync("git", ["ls-files", "--", ...dirs], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
}

/** An archive's file, downloaded once into the cache, checked against its pinned SHA-256 and unpacked there. */
async function fromArchive(/** @type {string} */ url, /** @type {{ archive: string, sha256: string, binary: string }} */ { archive, sha256, binary }) {
    const file = join(CACHE, archive);
    if (!existsSync(file)) {
        mkdirSync(CACHE, { recursive: true });
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url} answered ${response.status}`);
        writeFileSync(file, new Uint8Array(await response.arrayBuffer()));
    }
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (actual !== sha256) {
        rmSync(file);
        throw new Error(`${archive} has SHA-256 ${actual}, not the pinned ${sha256}`);
    }
    if (!existsSync(join(CACHE, binary))) execFileSync("tar", ["-xf", file, "-C", CACHE]);
    return join(CACHE, binary);
}

/** Node's binary for a target. */
const nodeBinary = (/** @type {Target} */ target) => {
    const { archive, sha256, binary } = TARGETS[target];
    const dir = archive.replace(/\.(tar\.gz|tar\.xz|zip)$/, "");
    return fromArchive(`https://nodejs.org/dist/v${NODE_VERSION}/${archive}`, { archive, sha256, binary: `${dir}/${binary}` });
};
const uvBinary = () => fromArchive(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${UV.archive}`, UV);

const host = /** @type {Target} */ (`${process.platform === "win32" ? "win" : process.platform}-${process.arch}`);
if (!(host in TARGETS)) throw new Error(`No Node build to run --build-sea with on ${host}`);
if (readFileSync(join(ROOT, ".node-version"), "utf8").trim() !== NODE_VERSION) throw new Error(`.node-version isn't ${NODE_VERSION}: update TARGETS`);
if (!readFileSync(join(ROOT, "dictation", "worker", "pyproject.toml"), "utf8").includes(`required-version = "==${UV_VERSION}"`))
    throw new Error(`dictation/worker/pyproject.toml doesn't require uv ${UV_VERSION}: update UV`);
const targets = /** @type {Target[]} */ (process.argv.length > 2 ? process.argv.slice(2) : Object.keys(TARGETS));
for (const target of targets) if (!(target in TARGETS)) throw new Error(`Unknown target ${target}: one of ${Object.keys(TARGETS).join(", ")}`);
for (const file of CARRIED) if (!existsSync(join(ROOT, file))) throw new Error(`Missing ${file}: run pnpm build first`);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);
const script = join(DIST, "agent-chat-bridge.cjs");
await build({
    entryPoints: [join(ROOT, "scripts", "executable.mjs")], outfile: script, bundle: true, platform: "node", format: "cjs",
    target: `node${NODE_VERSION}`, logLevel: "warning",
    // Only the executable runs this script: scripts/bundle.mjs reads no import.meta in it, and nothing runs as a module.
    logOverride: { "empty-import-meta": "silent" }
});
const builder = await nodeBinary(host);
for (const target of targets) {
    const [os = "", arch = ""] = target.split("-");
    // The name scripts/repatch.mjs looks for among a release's files.
    const output = join(DIST, executableName(os === "win" ? "win32" : os, arch));
    /** Each carried file by its path in the repo, which is where scripts/bundle.mjs unpacks it. */
    const files = Object.fromEntries([...CARRIED, ...target === UV.target ? DICTATION : []].map(file => [file, join(ROOT, file)]));
    if (target === UV.target) files["tools/uv"] = await uvBinary();
    const manifest = join(DIST, `files-${target}.json`);
    writeFileSync(manifest, JSON.stringify(Object.keys(files)));
    const config = join(DIST, `sea-${target}.json`);
    writeFileSync(config, JSON.stringify({
        main: script, output, executable: await nodeBinary(target), assets: { [MANIFEST]: manifest, ...files },
        disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false
    }));
    execFileSync(builder, ["--build-sea", config], { stdio: "inherit" });
    if (target.startsWith("darwin")) execFileSync("codesign", ["--force", "--sign", "-", output], { stdio: "inherit" });
    console.log(`${output}: ${Math.round(statSync(output).size / 1e6)} MB`);
}
