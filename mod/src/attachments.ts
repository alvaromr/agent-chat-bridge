// Files that `draft --attach` puts in the chat box, read by the main process from the paths the caller gives.
import { readFileSync, statSync } from "fs";
import { basename, extname } from "path";

import type { ComposeRequest } from "./ipc";
import { MAX_ATTACHMENT_MB } from "./limits.mts";

const MIME_TYPES: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".pdf": "application/pdf", ".txt": "text/plain"
};

/** Why a file can't be attached, as the CLI shows it to the user. */
const TEXT = {
    notFile: (path: string) => `No es un fichero: ${path}`,
    missing: (path: string) => `No existe: ${path}`,
    unreadable: (path: string, code: string) => `No se puede leer (${code}): ${path}`,
    tooBig: (path: string) => `Pasa de ${MAX_ATTACHMENT_MB} MB: ${path}`
};

/** Reads the files to attach, or says which one can't be. */
export function readAttachments(paths: string[]): NonNullable<ComposeRequest["files"]> | string {
    const files: NonNullable<ComposeRequest["files"]> = [];
    for (const path of paths) {
        let data: Buffer;
        try {
            const stat = statSync(path);
            if (!stat.isFile()) return TEXT.notFile(path);
            if (stat.size > MAX_ATTACHMENT_MB * 1024 * 1024) return TEXT.tooBig(path);
            data = readFileSync(path);
        } catch (err: any) {
            return err.code === "ENOENT" ? TEXT.missing(path) : TEXT.unreadable(path, err.code);
        }
        files.push({ name: basename(path), type: MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream", data });
    }
    return files;
}
