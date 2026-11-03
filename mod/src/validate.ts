// Checks every request that reaches the local socket (mod/src/compose.ts) before anything acts on it.
// Only Node built-ins and ipc.ts, so test/ can load it straight from Node.
import { isAbsolute } from "path";

import { type Command, commandOf, type ComposeRequest } from "./ipc";
import { MAX_ATTACHMENTS, MAX_EXTRA_PAGES, MAX_READ_LIMIT, MAX_WATCHED_CHATS } from "./limits.mts";

const KINDS = ["dm", "grupo", "canal", "hilo"];

const isId = (v: unknown) => typeof v === "string" && /^\d{1,20}$/.test(v);
const isTime = (v: unknown) => v === undefined || (Number.isSafeInteger(v) && (v as number) >= 0);
const isServer = (v: unknown) => v === undefined || (typeof v === "string" && v.length >= 1 && v.length <= 100);
const isKinds = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(k => KINDS.includes(k as string)));
const isFlag = (v: unknown) => v === undefined || typeof v === "boolean";

function isDraft(req: any) {
    if (req.files !== undefined) return false; // only the main process fills it in
    if (req.clear !== undefined)
        return req.clear === true && req.text === undefined && req.attach === undefined && req.replyTo === undefined
            && (req.channelId === undefined ? typeof req.query === "string" && req.query.length <= 200 : isId(req.channelId))
            && isFlag(req.dryRun);
    const attach = req.attach === undefined
        || (Array.isArray(req.attach) && req.attach.length <= MAX_ATTACHMENTS
            && req.attach.every((p: unknown) => typeof p === "string" && isAbsolute(p)));
    const hasText = typeof req.text === "string" && req.text.trim() !== "";
    // Past the first line, req.text is a string or undefined.
    return attach && (hasText || (!!req.attach?.length && (req.text === undefined || req.text === "")))
        && (req.text === undefined || req.text.length <= 4000)
        && (req.replyTo === undefined || isId(req.replyTo))
        && (typeof req.query === "string" ? req.query.length <= 200 : req.query === undefined)
        && (req.channelId === undefined || isId(req.channelId))
        && (req.query !== undefined || req.channelId !== undefined)
        && isFlag(req.replace) && isFlag(req.dryRun) && isFlag(req.background);
}

/** Each command's own checks; the compiler asks for one per command of ipc.ts. */
const CHECKS: Record<Command, (req: any) => boolean> = {
    list: req => req.list === true && isKinds(req.kinds),
    unread: req => req.unread === true && isKinds(req.kinds),
    read: req => isId(req.read)
        && (req.limit === undefined || (Number.isInteger(req.limit) && req.limit >= 1 && req.limit <= MAX_READ_LIMIT))
        && isFlag(req.fetch) && isFlag(req.unreadOnly) && isFlag(req.more)
        && (req.older === undefined || (!req.more && Number.isInteger(req.older) && req.older >= 1 && req.older <= MAX_EXTRA_PAGES)),
    send: req => isId(req.send) && typeof req.expect === "string" && req.expect.length <= 4000 && isFlag(req.direct)
        && (req.replyTo === undefined || (req.direct === true && isId(req.replyTo))),
    react: ({ react: r }) => isId(r?.chatId) && isId(r.messageId)
        && typeof r.emoji === "string" && r.emoji.length > 0 && r.emoji.length <= 32 && !/[\s:<>]/.test(r.emoji)
        && isFlag(r.remove),
    edit: ({ edit: e }) => isId(e?.chatId) && isId(e.messageId)
        && typeof e.text === "string" && e.text.trim() !== "" && e.text.length <= 4000,
    delete: ({ delete: d }) => isId(d?.chatId) && isId(d.messageId),
    draft: isDraft
};

export function isValid(req: any): req is ComposeRequest {
    if (typeof req !== "object" || req === null || !isTime(req.since) || !isTime(req.until) || !isServer(req.server)) return false;
    return CHECKS[commandOf(req)](req);
}

/** The chat ids of a valid watch request, or null if the line is any other request. */
export function watchRequest(raw: string): string[] | null {
    try {
        const { watch } = JSON.parse(raw);
        return Array.isArray(watch) && watch.length >= 1 && watch.length <= MAX_WATCHED_CHATS && watch.every(isId) ? watch : null;
    } catch {
        return null;
    }
}
