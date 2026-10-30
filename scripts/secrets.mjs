// Secret scan of the history and the working tree (`pnpm secrets`, part of `pnpm check`), with the reviewed gitleaks.
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

// gitleaks comes from Homebrew, which checks each download against the checksum in its formula. Only this version's
// binary runs, by its path, so a `brew upgrade` never runs a new release before its changelog is read and this bumped.
const VERSION = "8.30.1";

let cellar;
try {
    cellar = execFileSync("brew", ["--cellar"], { encoding: "utf8" }).trim();
} catch (err) {
    console.error(`Homebrew is required to install gitleaks ${VERSION}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
}
const gitleaks = join(cellar, "gitleaks", VERSION, "bin", "gitleaks");
if (!existsSync(gitleaks)) {
    console.error(`gitleaks ${VERSION} is required (brew install gitleaks); not found at ${gitleaks}`);
    process.exit(1);
}

const flags = ["--redact", "--no-banner", "--log-level=warn"];
try {
    execFileSync(gitleaks, ["git", ...flags], { stdio: "inherit" });
    execFileSync(gitleaks, ["dir", ...flags], { stdio: "inherit" });
} catch {
    process.exit(1); // gitleaks already printed what it found
}
