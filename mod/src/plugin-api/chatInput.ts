// The open chat's box: its draft, its editor, and writing into it or sending from it through Discord's own events.
import { ComponentDispatch, DraftStore, DraftType } from "./discord";

export const getDraft = (channelId: string) => DraftStore.getDraft(channelId, DraftType.ChannelMessage);

/** The open chat's own text box (not the edit box of a sent message). */
export const chatEditor = () => document.querySelector<HTMLElement>('[class*="channelTextArea"] [data-slate-editor="true"]');

/** Presses Enter in the chat box as the user would, so Discord sends through its own path. */
export const pressEnter = (editor: HTMLElement) =>
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));

/** Inserts the text at the box's cursor, or over its selection. */
export function insertTextIntoChatInputBox(text: string) {
    ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
        rawText: text,
        plainText: text
    });
}

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
