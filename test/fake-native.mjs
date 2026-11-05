// A fake of what mod/src/preload.ts exposes to the page as `window.AgentChatBridgeNative`: the main process's side,
// as mocks a test drives. Importing it installs it, so the renderer modules find it when they load.
import { vi } from "vitest";

/** What the main process holds: the saved settings and the handlers the page registered. */
export const main = {
    /** @type {Record<string, Record<string, unknown>>} */
    settings: {},
    /** @type {((req: any) => Promise<any>) | undefined} */
    compose: undefined,
    /** @type {((chatIds: string[]) => void) | undefined} */
    watch: undefined,
    /** @type {((event: any) => void) | undefined} */
    dictation: undefined,
    /** The chats the CLI watches, as the main process answers the first `onWatchChange`. */
    watched: /** @type {string[]} */ ([])
};

/** Typed loosely: the tests read the mocks' calls and replace their behaviour. @type {any} */
export const native = {
    getSettings: vi.fn(() => structuredClone(main.settings)),
    setSettings: vi.fn(async settings => void (main.settings = structuredClone(settings))),
    runClaude: vi.fn(async () => ({ ok: true, text: "" })),
    onComposeRequest: vi.fn(handler => void (main.compose = handler)),
    onWatchChange: vi.fn(handler => {
        main.watch = handler;
        handler(main.watched);
    }),
    emitWatchEvent: vi.fn(),
    dictation: {
        models: vi.fn(() => ["mlx-community/whisper-large-v3-turbo"]),
        start: vi.fn(async () => ({ ok: true })),
        audio: vi.fn(),
        stop: vi.fn(),
        cancel: vi.fn(),
        onEvent: vi.fn(handler => void (main.dictation = handler))
    }
};
/** @type {any} */ (window).AgentChatBridgeNative = native;
