// Plugin settings on disk. Any page script can reach these handlers, so writes must be a plain object under a size cap.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

const MAX_BYTES = 256 * 1024;

/** The settings file at that path. A file that exists but can't be used is never overwritten by a later save. */
export function settingsFile(file: string) {
    let blocked = false;

    /** The defaults apply; the file moves aside, or saving stays blocked if it can't be moved. Says so for the user. */
    function unreadable(reason: string) {
        const copy = `${file}.unreadable-${Date.now()}`;
        try {
            renameSync(file, copy);
        } catch (err: any) {
            blocked = true;
            console.error(`[discord-mod] Unreadable settings, using the defaults: ${file}: ${reason}; not moved: ${err.message}`);
            return `No se pudieron leer los ajustes (${reason}), así que se usan los de por defecto. Tampoco se pudo apartar el fichero, así que los cambios no se guardarán hasta que lo arregles o lo borres: ${file}`;
        }
        console.error(`[discord-mod] Unreadable settings, using the defaults: ${file}: ${reason}; moved to ${copy}`);
        return `No se pudieron leer los ajustes (${reason}), así que se usan los de por defecto. El fichero queda en ${copy}`;
    }

    return {
        /** The saved settings, none if there is no file yet, and the problem for the user if the file can't be used. */
        read(): { settings: Record<string, unknown>; problem?: string; } {
            let saved: unknown;
            try {
                saved = JSON.parse(readFileSync(file, "utf8"));
            } catch (err: any) {
                return err.code === "ENOENT" ? { settings: {} } : { settings: {}, problem: unreadable(err.message) };
            }
            if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return { settings: {}, problem: unreadable("no es un objeto JSON") };
            return { settings: saved as Record<string, unknown> };
        },

        write(settings: unknown) {
            if (blocked) throw new Error(`Los ajustes guardados no se pudieron leer; arregla o borra ${file}`);
            const json = JSON.stringify(settings, null, 4);
            if (typeof settings !== "object" || settings === null || Array.isArray(settings) || json.length > MAX_BYTES)
                throw new Error("Ajustes no válidos");

            mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
            writeFileSync(`${file}.tmp`, json, { mode: 0o600 });
            renameSync(`${file}.tmp`, file);
        }
    };
}
