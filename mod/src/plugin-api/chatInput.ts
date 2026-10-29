// Writing into the open chat's box through Discord's own text-box events.
import { ComponentDispatch } from "./discord";

/** Inserts the text at the box's cursor, or over its selection. */
export function insertTextIntoChatInputBox(text: string) {
    ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
        rawText: text,
        plainText: text
    });
}
