// The Electron APIs mod/ calls, as Discord's own Electron provides them at run time. Declared here because Electron's
// published types come with its binary package, which nothing here needs.
declare module "electron" {
    interface WebContents {
        getURL(): string;
        send(channel: string, ...args: unknown[]): void;
    }

    interface IpcMainInvokeEvent {
        /** The page that sent the message. */
        sender: WebContents;
    }
    interface IpcMainEvent extends IpcMainInvokeEvent {
        /** The answer to an `ipcRenderer.sendSync`. */
        returnValue: unknown;
    }
    type IpcRendererEvent = object;

    interface BrowserWindowInstance {
        webContents: WebContents;
        isMinimized(): boolean;
        restore(): void;
        show(): void;
    }

    export const app: {
        getPath(name: "appData"): string;
        /** Undocumented: the path Electron loads the app from, so Discord finds its own files in _app.asar. */
        setAppPath(path: string): void;
        focus(options: { steal: boolean; }): void;
        once(event: "ready", listener: () => void): void;
        on(event: "will-quit", listener: () => void): void;
    };

    export const BrowserWindow: { getAllWindows(): BrowserWindowInstance[]; };

    export const dialog: { showMessageBox(options: { type: "warning"; message: string; detail: string; }): Promise<unknown>; };

    export const ipcMain: {
        on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void;
        handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void;
    };

    export const session: {
        defaultSession: { registerPreloadScript(script: { type: "frame"; id: string; filePath: string; }): void; };
    };

    export const contextBridge: { exposeInMainWorld(key: string, api: object): void; };

    export const ipcRenderer: {
        send(channel: string, ...args: unknown[]): void;
        sendSync(channel: string, ...args: unknown[]): any;
        invoke(channel: string, ...args: unknown[]): Promise<any>;
        on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void;
    };

    export const webFrame: { executeJavaScript(code: string): Promise<unknown>; };

    export type { IpcMainEvent, IpcMainInvokeEvent, WebContents };
}
