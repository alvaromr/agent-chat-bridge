// Where the patch lives in the installed Discord, and whether Discord runs: shared by the patcher (scripts/inject.mjs)
// and the re-patch after an update (scripts/repatch.mjs).
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export const RESOURCES = "/Applications/Discord.app/Contents/Resources";
export const ASAR = join(RESOURCES, "app.asar");
/** Discord's own app.asar, kept aside while patched: its absence means Discord is not patched. */
export const ORIGINAL = join(RESOURCES, "_app.asar");

/** Whether Discord's main process is running. */
export function discordRunning() {
    try {
        execFileSync("pgrep", ["-x", "Discord"], { stdio: "ignore" });
        return true;
    } catch (err) {
        if (err instanceof Error && "status" in err && err.status === 1) return false; // pgrep found no such process
        throw err;
    }
}
