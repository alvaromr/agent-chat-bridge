// For a test that writes into the app's folder: points the variables that place it on Windows (APPDATA) and Linux
// (XDG_CONFIG_HOME) into a temporary home, so the test never writes into the real one of whoever runs it, which
// mod/src/platform.mts would otherwise find through them. Undone with vi.unstubAllEnvs().
import { join } from "node:path";

import { vi } from "vitest";

export function stubAppFolders(/** @type {string} */ home) {
    vi.stubEnv("APPDATA", join(home, "AppData", "Roaming"));
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
}
