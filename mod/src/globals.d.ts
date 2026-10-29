/** Loaded as text by mod/build.mjs. */
declare module "*.css" {
    const css: string;
    export default css;
}

interface Window {
    /** Exposed by mod/src/preload.ts. */
    DiscordModNative: {
        getSettings(): Record<string, Record<string, unknown>>;
        setSettings(settings: unknown): Promise<void>;
        runClaude(systemPrompt: string, input: string, model: string): Promise<import("../../plugins/shared/run").ClaudeResult>;
        onComposeRequest(handler: (req: import("./ipc").ComposeRequest) => Promise<import("./ipc").ComposeResult>): void;
        onWatchChange(handler: (chatIds: string[]) => void): void;
        emitWatchEvent(event: import("./ipc").ComposeEvent): void;
    };
}
