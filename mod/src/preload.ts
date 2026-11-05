// Session preload: runs in every main frame of Discord's session, before Discord's own preload.
import { contextBridge, ipcRenderer, webFrame } from "electron";

import type { DictationEvent, DictationRequest } from "../../plugins/dictation/main";
import { type ComposeEvent, type ComposeRequest, type ComposeResult, IPC } from "./ipc";

// The splash screen and other local pages share the session; only the Discord app gets the mod.
if (location.origin === "https://discord.com") {
    let composeHandlerSet = false;
    let watchHandlerSet = false;
    let dictationHandlerSet = false;

    contextBridge.exposeInMainWorld("AgentChatBridgeNative", {
        getSettings: () => ipcRenderer.sendSync(IPC.getSettings),
        setSettings: (settings: unknown) => ipcRenderer.invoke(IPC.setSettings, settings),
        runClaude: (systemPrompt: string, input: string, model: string) => ipcRenderer.invoke(IPC.runClaude, systemPrompt, input, model),
        // Only the first handler counts: the mod registers it before Discord's scripts run, so they can't take over.
        onComposeRequest(handler: (req: ComposeRequest) => Promise<ComposeResult>) {
            if (composeHandlerSet) return;
            composeHandlerSet = true;
            ipcRenderer.on(IPC.composeRequest, async (_, id: number, req: ComposeRequest) => {
                const result = await handler(req).catch(err => ({ ok: false, error: String(err) }) as ComposeResult);
                ipcRenderer.send(IPC.composeResponse, id, result);
            });
        },
        // Same first-handler-only rule: the mod gets the watched chats, then every change to them.
        onWatchChange(handler: (chatIds: string[]) => void) {
            if (watchHandlerSet) return;
            watchHandlerSet = true;
            ipcRenderer.on(IPC.watchSet, (_, chatIds: string[]) => handler(chatIds));
            handler(ipcRenderer.sendSync(IPC.watchGet));
        },
        emitWatchEvent: (event: ComposeEvent) => ipcRenderer.send(IPC.watchEvent, event),
        dictation: {
            models: () => ipcRenderer.sendSync(IPC.dictationModels),
            start: (req: DictationRequest) => ipcRenderer.invoke(IPC.dictationStart, req),
            audio: (samples: Float32Array) => ipcRenderer.send(IPC.dictationAudio, samples),
            stop: () => ipcRenderer.send(IPC.dictationStop),
            cancel: () => ipcRenderer.send(IPC.dictationCancel),
            // Same first-handler-only rule: the dictation's texts go to the mod's plugin only.
            onEvent(handler: (event: DictationEvent) => void) {
                if (dictationHandlerSet) return;
                dictationHandlerSet = true;
                ipcRenderer.on(IPC.dictationEvent, (_, event: DictationEvent) => handler(event));
            }
        }
    } satisfies Window["AgentChatBridgeNative"]);

    // Runs in the page's own world before Discord's scripts, so the webpack hook is in place when they load.
    webFrame.executeJavaScript(ipcRenderer.sendSync(IPC.getRenderer));
}
