/** Loaded as text by mod/build.mjs. */
declare module "*.css" {
    const css: string;
    export default css;
}

interface Window {
    /** Exposed by mod/src/preload.ts. */
    AgentChatBridgeNative: {
        getSettings(): Record<string, Record<string, unknown>>;
        setSettings(settings: unknown): Promise<void>;
        runClaude(systemPrompt: string, input: string, model: string): Promise<import("../../plugins/shared/run").ClaudeResult>;
        onComposeRequest(handler: (req: import("./ipc").ComposeRequest) => Promise<import("./ipc").ComposeResult>): void;
        onWatchChange(handler: (chatIds: string[]) => void): void;
        emitWatchEvent(event: import("./ipc").ComposeEvent): void;
        dictation: {
            /** The ids of the Whisper models on disk. */
            models(): string[];
            start(req: import("../../plugins/dictation/main").DictationRequest): Promise<import("../../plugins/dictation/main").DictationStart>;
            /** 16 kHz mono samples, at most 1 s per call. */
            audio(samples: Float32Array): void;
            stop(): void;
            cancel(): void;
            onEvent(handler: (event: import("../../plugins/dictation/main").DictationEvent) => void): void;
        };
    };
}
