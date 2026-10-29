// Secret scan of the history and the working tree (`pnpm secrets`, part of `pnpm check`), with the reviewed gitleaks.
import { execFileSync } from "child_process";

// gitleaks is installed outside pnpm, so its version is checked here; bump it after reading its changelog.
const VERSION = "8.30.1";

let found;
try {
    found = execFileSync("gitleaks", ["version"], { encoding: "utf8" }).trim();
} catch (err) {
    console.error(`gitleaks ${VERSION} is required (brew install gitleaks): ${err instanceof Error ? err.message : err}`);
    process.exit(1);
}
if (found !== VERSION) {
    console.error(`gitleaks ${VERSION} is required, found ${found}`);
    process.exit(1);
}

const flags = ["--redact", "--no-banner", "--log-level=warn"];
try {
    execFileSync("gitleaks", ["git", ...flags], { stdio: "inherit" });
    execFileSync("gitleaks", ["dir", ...flags], { stdio: "inherit" });
} catch {
    process.exit(1); // gitleaks already printed what it found
}
