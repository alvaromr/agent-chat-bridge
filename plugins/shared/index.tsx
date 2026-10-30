// Renderer side shared by every plugin that talks to Claude.
import { insertTextIntoChatInputBox } from "@plugin-api/chatInput";
import { DraftStore, DraftType, showToast } from "@plugin-api/discord";
import type { IconComponent } from "@plugin-api/plugin";

/** The toasts the user sees while Claude answers. */
const TEXT = {
    asking: "Consultando a Claude…",
    failed: (error: string) => `Claude: ${error}`,
    actionFailed: (error: string) => `No se pudo terminar: ${error}`
};

/**
 * Shows the user that an action they started failed, which would otherwise only reach the console. Logs the error's
 * name and text only, never what it carries.
 */
export function reportFailure(err: unknown) {
    const text = err instanceof Error ? err.message : String(err);
    console.error(`[discord-mod] A plugin action failed: ${err instanceof Error ? err.name : typeof err}: ${text}`);
    showToast({ text: TEXT.actionFailed(text), variant: "critical" });
}

/** Resolves with Claude's text, or shows a toast and resolves with null. */
export async function askClaude(systemPrompt: string, input: string, model: string) {
    showToast({ text: TEXT.asking });
    const { ok, text } = await window.DiscordModNative.runClaude(systemPrompt, input, model);
    if (ok) return text;
    showToast({ text: TEXT.failed(text), variant: "critical" });
    return null;
}

export const getDraft = (channelId: string) => DraftStore.getDraft(channelId, DraftType.ChannelMessage);

/** Resolves once the condition holds or the timeout passes, whichever comes first. */
export async function waitFor(condition: () => boolean, timeoutMs: number) {
    for (const end = Date.now() + timeoutMs; !condition() && Date.now() < end;)
        await new Promise(r => setTimeout(r, 50));
}

/** Presses Enter in the chat box as the user would, so Discord sends through its own path. */
export const pressEnter = (editor: HTMLElement) =>
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));

/** The open chat's own text box (not the edit box of a sent message). */
export const chatEditor = () => document.querySelector<HTMLElement>('[class*="channelTextArea"] [data-slate-editor="true"]');

/**
 * Replaces the whole chat box text: selects everything in the editor and inserts over it, as pasting would.
 * CLEAR_TEXT only empties the stored draft now, not the editor, so the insert landed at the cursor.
 */
export async function replaceChatInput(text: string) {
    const editor = chatEditor();
    if (editor) {
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        document.getSelection()?.removeAllRanges();
        document.getSelection()?.addRange(range);
        // The editor reads the page's selection on `selectionchange`, at most every 100 ms.
        await new Promise(r => setTimeout(r, 150));
    }
    insertTextIntoChatInputBox(text);
}

export const SpellcheckIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg viewBox="0 0 24 24" height={height} width={width} className={className}>
        <path fill="currentColor" d="M12.45 16h2.09L9.43 3H7.57L2.46 16h2.09l1.12-3h5.64l1.14 3zm-6.02-5L8.5 5.48 10.57 11H6.43zm15.16.59l-8.09 8.09L9.83 16l-1.41 1.41 5.09 5.09L23 13l-1.41-1.41z" />
    </svg>
);

export const SparklesIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg viewBox="0 0 24 24" height={height} width={width} className={className}>
        <path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z" />
    </svg>
);
