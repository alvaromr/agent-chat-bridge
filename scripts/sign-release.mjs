// Signs each executable in dist/ with the release key's private half, from the RELEASE_SIGNING_KEY variable (the
// release workflow's secret, .github/workflows/release.yml), into `<executable>.sig`: the ed25519 signature that the
// executable checks before it installs an update (scripts/repatch.mjs). It first checks the key against the public
// half in scripts/release-key.mjs, so a wrong secret fails here, not on every user's machine. Only I/O, checked by
// running it (docs/decisions/coverage-io-scripts-and-worker.md).
import { createPrivateKey, sign, verify } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { RELEASE_KEY } from "./release-key.mjs";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));

const pem = process.env.RELEASE_SIGNING_KEY;
if (!pem) throw new Error("RELEASE_SIGNING_KEY is not set");
const key = createPrivateKey(pem);
const probe = Buffer.from("agent-chat-bridge");
if (!verify(null, probe, RELEASE_KEY, sign(null, probe, key))) throw new Error("RELEASE_SIGNING_KEY isn't the private half of scripts/release-key.mjs");

const executables = readdirSync(DIST).filter(name => /^agent-chat-bridge-[a-z]+-[a-z0-9]+(\.exe)?$/.test(name));
if (!executables.length) throw new Error("No executables in dist/: run pnpm build-executable first");
for (const name of executables) {
    writeFileSync(join(DIST, `${name}.sig`), sign(null, readFileSync(join(DIST, name)), key));
    console.log(`Signed ${name}`);
}
