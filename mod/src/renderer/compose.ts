// Answers scripts/acb.mjs: each command of ipc.ts goes to its handler, in chats.ts (`list`, `unread`), read.ts
// (`read`) or write.ts (drafts, and sends, edits, deletes and reactions).
import { type Command, commandOf, type ComposeRequest, type ComposeResult, type RequestFor } from "../ipc";
import { listChats, unreadChats } from "./chats";
import { readChat } from "./read";
import { draft, edit, react, remove, send, sendDirect, unreact } from "./write";

/** Each command's handler; the compiler asks for one per command of ipc.ts. */
const HANDLERS: { [C in Command]: (req: RequestFor<C>) => Promise<ComposeResult> } = {
    list: async req => ({ ok: true, chats: listChats(req) }),
    unread: async req => ({ ok: true, sinLeer: unreadChats(req) }),
    read: readChat,
    send,
    sendDirect,
    react: req => react(req.react),
    unreact: req => unreact(req.unreact),
    edit: req => edit(req.edit),
    delete: req => remove(req.delete),
    draft
};

export function compose(req: ComposeRequest): Promise<ComposeResult> {
    // commandOf only names a command whose key the request has, which is what that handler's type asks for.
    return (HANDLERS[commandOf(req)] as (req: ComposeRequest) => Promise<ComposeResult>)(req);
}
