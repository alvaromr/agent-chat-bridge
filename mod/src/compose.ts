// Local socket for scripts/acb.mjs. Only the user's account can connect (socket 0600 in a 0700 dir).
// Validates each request, reads files to attach, hands the request to the renderer and brings Discord to the front
// after a draft.
import { app, BrowserWindow, ipcMain } from "electron";
import { chmodSync, mkdirSync, rmSync } from "fs";
import { createServer, Socket } from "net";
import { join } from "path";

import { readAttachments } from "./attachments";
import { type ComposeEvent, type ComposeRequest, type ComposeResult, IPC } from "./ipc";
import { APP_NAME, SOCKET_FILE } from "./name.mts";
import { log } from "./plugin-api/log";
import { isValid, watchRequest } from "./validate";

const SOCKET = join(app.getPath("appData"), APP_NAME, SOCKET_FILE);
const MAX_REQUEST_BYTES = 16 * 1024;
const TIMEOUT_MS = 10_000;

/** Why a request couldn't be done, as the CLI shows it to the user. */
const TEXT = {
    invalid: "Petición no válida",
    noWindow: "Discord no tiene la ventana principal abierta",
    noAnswer: "Discord no respondió",
    failed: "Discord no pudo atender la petición"
} as const;

const pending = new Map<number, (result: ComposeResult) => void>();
let nextId = 0;

ipcMain.on(IPC.composeResponse, (_, id: number, result: ComposeResult) => pending.get(id)?.(result));

const mainWindow = () => BrowserWindow.getAllWindows().find(w => {
    const url = w.webContents.getURL();
    return url.startsWith("https://discord.com/") && !url.startsWith("https://discord.com/popout");
});

/** Open `watch` connections and their chats. The renderer only forwards messages of chats someone watches. */
const watchers = new Map<Socket, Set<string>>();
const watchedChats = () => [...new Set([...watchers.values()].flatMap(ids => [...ids]))];
const announceWatched = () => mainWindow()?.webContents.send(IPC.watchSet, watchedChats());

ipcMain.on(IPC.watchGet, e => {
    e.returnValue = watchedChats();
});
ipcMain.on(IPC.watchEvent, (_, event: ComposeEvent) => {
    for (const [conn, ids] of watchers) if (ids.has(event?.chat?.id)) conn.write(JSON.stringify(event) + "\n");
});

function startWatching(conn: Socket, ids: string[]) {
    watchers.set(conn, new Set(ids));
    announceWatched();
    conn.on("close", () => {
        watchers.delete(conn);
        announceWatched();
    });
    conn.write(JSON.stringify({ ok: true, escuchando: ids }) + "\n");
}

async function handle(raw: string): Promise<ComposeResult> {
    let req: unknown;
    try {
        req = JSON.parse(raw);
    } catch {
        return { ok: false, error: TEXT.invalid };
    }
    if (!isValid(req)) return { ok: false, error: TEXT.invalid };

    const win = mainWindow();
    if (!win) return { ok: false, error: TEXT.noWindow };

    if (req.attach?.length) {
        const files = readAttachments(req.attach);
        if (typeof files === "string") return { ok: false, error: files };
        req = { ...req, attach: undefined, files };
    }

    const id = nextId++;
    const result = await new Promise<ComposeResult>(resolve => {
        const timer = setTimeout(() => resolve({ ok: false, error: TEXT.noAnswer }), TIMEOUT_MS);
        pending.set(id, r => {
            clearTimeout(timer);
            resolve(r);
        });
        win.webContents.send(IPC.composeRequest, id, req);
    }).finally(() => pending.delete(id));

    // Only a loaded draft brings Discord to the front; listing and reading stay in the background.
    if (result.ok && "borradorCargado" in result && !(req as ComposeRequest).dryRun && !(req as ComposeRequest).background) {
        if (win.isMinimized()) win.restore();
        win.show();
        app.focus({ steal: true });
    }
    return result;
}

export function startComposeServer() {
    mkdirSync(join(SOCKET, ".."), { recursive: true, mode: 0o700 });
    rmSync(SOCKET, { force: true }); // left over by a previous run that didn't exit cleanly

    const server = createServer(conn => {
        let data = "";
        conn.setEncoding("utf8");
        conn.on("data", chunk => {
            data += chunk;
            if (data.length > MAX_REQUEST_BYTES) return conn.destroy();
            if (!data.includes("\n") || watchers.has(conn)) return;
            const line = data.slice(0, data.indexOf("\n"));
            const ids = watchRequest(line);
            if (ids) return startWatching(conn, ids);
            // Every request gets an answer, so a failure never leaves the CLI waiting for one.
            handle(line)
                .catch((err: unknown): ComposeResult => {
                    log.error(`CLI request failed: ${err instanceof Error ? err.message : err}`);
                    return { ok: false, error: TEXT.failed };
                })
                .then(r => conn.end(JSON.stringify(r) + "\n"));
        });
        // Without a listener a socket error would crash the main process. The CLI hanging up (Ctrl+C on watch, a closed
        // pipe) is normal; anything else is logged, by code only.
        conn.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code !== "EPIPE" && err.code !== "ECONNRESET") log.error(`CLI connection failed: ${err.code ?? err.message}`);
        });
    });
    server.listen(SOCKET, () => chmodSync(SOCKET, 0o600));
    app.on("will-quit", () => {
        server.close();
        rmSync(SOCKET, { force: true });
    });
}
