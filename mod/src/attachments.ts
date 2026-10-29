// Files that `draft --attach` puts in the chat box, read by the main process from the paths the caller gives.
import { readFileSync, statSync } from "fs";
import { basename, extname } from "path";

import type { ComposeRequest } from "./ipc";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // Discord's upload limit without Nitro
const MIME_TYPES: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".pdf": "application/pdf", ".txt": "text/plain"
};

/** Reads the files to attach, or says which one can't be. */
export function readAttachments(paths: string[]): NonNullable<ComposeRequest["files"]> | string {
    const files: NonNullable<ComposeRequest["files"]> = [];
    for (const path of paths) {
        let size: number;
        try {
            const stat = statSync(path);
            if (!stat.isFile()) return `No es un fichero: ${path}`;
            size = stat.size;
        } catch (err: any) {
            return err.code === "ENOENT" ? `No existe: ${path}` : `No se puede leer (${err.code}): ${path}`;
        }
        if (size > MAX_ATTACHMENT_BYTES) return `Pasa de 25 MB: ${path}`;
        files.push({ name: basename(path), type: MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream", data: readFileSync(path) });
    }
    return files;
}
