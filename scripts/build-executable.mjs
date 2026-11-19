// `pnpm build-executable [<target>...]`: the release's single executable for each system (all by default), into dist/.
// It bundles scripts/executable.mjs with esbuild, puts it with the files it carries (scripts/bundle.mjs) into Node's
// official binary for the target as a single executable application (node --build-sea), and signs the macOS ones
// locally, without which macOS won't run them. Node's archives are checked against the SHA-256 pinned here, from
// nodejs.org's SHASUMS256.txt. Only I/O, checked by running it (docs/decisions/coverage-io-scripts-and-worker.md).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { MANIFEST } from "./bundle.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const CACHE = join(ROOT, "node_modules", ".cache", "agent-chat-bridge-node");
const NODE_VERSION = "26.13.0";

/** Node's official archive for each target, its SHA-256, and where its binary is inside. */
const TARGETS = {
    "darwin-arm64": { archive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, sha256: "d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6", binary: "bin/node" },
    "darwin-x64": { archive: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, sha256: "525c9b29bb0263d687de60a4cec0e2a6db876a8eb032369e5795eca71e7c358e", binary: "bin/node" },
    "linux-x64": { archive: `node-v${NODE_VERSION}-linux-x64.tar.xz`, sha256: "d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997", binary: "bin/node" },
    "win-x64": { archive: `node-v${NODE_VERSION}-win-x64.zip`, sha256: "dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a", binary: "node.exe" }
};
/** @typedef {keyof typeof TARGETS} Target */

/** What the executable carries besides its script: the patch, and the sources and styles the Discord check reads. */
const CARRIED = [
    ...["main", "preload", "renderer"].map(name => `mod/dist/${name}.js`),
    ...trackedFiles(["mod/src", "plugins"]).filter(file => /\.(ts|tsx|mts|css)$/.test(file) && !file.endsWith(".d.ts")),
    ...trackedFiles(["skills/agent-chat-bridge"])
];

function trackedFiles(/** @type {string[]} */ dirs) {
    return execFileSync("git", ["ls-files", "--", ...dirs], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
}

/** Node's binary for a target, downloaded once into the cache and checked against its pinned SHA-256. */
async function nodeBinary(/** @type {Target} */ target) {
    const { archive, sha256, binary } = TARGETS[target];
    const dir = join(CACHE, archive.replace(/\.(tar\.gz|tar\.xz|zip)$/, ""));
    const file = join(CACHE, archive);
    if (!existsSync(file)) {
        mkdirSync(CACHE, { recursive: true });
        const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${archive}`);
        if (!response.ok) throw new Error(`nodejs.org answered ${response.status} for ${archive}`);
        writeFileSync(file, new Uint8Array(await response.arrayBuffer()));
    }
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (actual !== sha256) {
        rmSync(file);
        throw new Error(`${archive} has SHA-256 ${actual}, not the pinned ${sha256}`);
    }
    if (!existsSync(dir)) execFileSync("tar", ["-xf", file, "-C", CACHE]);
    return join(dir, binary);
}

const host = /** @type {Target} */ (`${process.platform === "win32" ? "win" : process.platform}-${process.arch}`);
if (!(host in TARGETS)) throw new Error(`No Node build to run --build-sea with on ${host}`);
if (readFileSync(join(ROOT, ".node-version"), "utf8").trim() !== NODE_VERSION) throw new Error(`.node-version isn't ${NODE_VERSION}: update TARGETS`);
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
const manifest = join(DIST, MANIFEST);
writeFileSync(manifest, JSON.stringify(CARRIED));
const assets = { [MANIFEST]: manifest, ...Object.fromEntries(CARRIED.map(file => [file, join(ROOT, file)])) };

const builder = await nodeBinary(host);
for (const target of targets) {
    const output = join(DIST, `agent-chat-bridge-${target}${target.startsWith("win") ? ".exe" : ""}`);
    const config = join(DIST, `sea-${target}.json`);
    writeFileSync(config, JSON.stringify({
        main: script, output, executable: await nodeBinary(target), assets,
        disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false
    }));
    execFileSync(builder, ["--build-sea", config], { stdio: "inherit" });
    if (target.startsWith("darwin")) execFileSync("codesign", ["--force", "--sign", "-", output], { stdio: "inherit" });
    console.log(`${output}: ${Math.round(statSync(output).size / 1e6)} MB`);
}
