// Plugin settings on disk. Any page script can reach these handlers, so writes must be a plain object under a size cap.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

const MAX_BYTES = 256 * 1024;

/** The saved settings; none if the file doesn't exist yet, and none with an error logged if it can't be read. */
export function readSettings(file: string): Record<string, unknown> {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch (err: any) {
        if (err.code !== "ENOENT") console.error(`[discord-mod] Unreadable settings, using the defaults: ${file}: ${err.message}`);
        return {};
    }
}

export function writeSettings(file: string, settings: unknown) {
    const json = JSON.stringify(settings, null, 4);
    if (typeof settings !== "object" || settings === null || Array.isArray(settings) || json.length > MAX_BYTES)
        throw new Error("Ajustes no válidos");

    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, json, { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
}
