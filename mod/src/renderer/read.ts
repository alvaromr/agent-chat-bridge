// What the CLI reads: a chat's loaded messages (`read`) and the new, edited and deleted ones of the chats a `watch`
// listens to, both in the same shape. Requests to Discord's API are limited by rule 3: `read --fetch` (one page, as
// opening a chat), `read --more` and `read --older` (older pages, as scrolling up).
import type { ComposeRequest, ComposeResult } from "../ipc";
import { MAX_EXTRA_PAGES } from "../limits.mts";
import {
    ChannelStore, FluxDispatcher, GuildMemberStore, GuildRoleStore, MessageActions, MessageManager, MessageStore, ReadStateStore, UserStore
} from "../plugin-api/discord";
import { CONFIRM_MS, waitFor } from "../plugin-api/wait";
import { allCandidates, pick, TEXT as CHATS_TEXT, userName } from "./chats";
import { firstTimeChecker } from "./dedupe";
import { embedTexts, type Names, reaction, readableMentions } from "./format";
import { type Candidate, selectMessages } from "./match";

/** Why a request couldn't be done, as the CLI shows it to the user. */
const TEXT = {
    notFetched: "Discord no tiene cargados los mensajes de ese chat; repite con --fetch",
    fetchFailed: "Discord no cargó los mensajes de ese chat"
} as const;

/** Between older pages, as a person scrolling up waits to see each one before the next. */
const PAGE_PAUSE_MS = 1500;
/** The most messages Discord's API returns per page. */
const PAGE_SIZE = 50;

/** The names that mentions in a chat of that server stand for. */
const namesIn = (guildId: string | undefined): Names => ({
    user: id => userName(id)[0],
    role: id => guildId ? GuildRoleStore.getRole(guildId, id)?.name : undefined,
    channel: id => ChannelStore.getChannel(id)?.name
});

const MAX_EXCERPT = 200;
const authorName = (a: any): string => a.globalName ?? a.global_name ?? a.username;

const isUnread = (chatId: string) => {
    const ack = ReadStateStore.ackMessageId(chatId);
    return (m: { id: string; }) => ack == null || BigInt(m.id) > BigInt(ack);
};

/**
 * One message as the CLI returns it. Takes both Discord's stored messages (camelCase, from MessageStore) and the raw
 * API objects that MESSAGE_CREATE carries (snake_case), so `read` and `watch` give the same shape.
 */
function formatMessage(m: any, chat: Candidate) {
    const me = UserStore.getCurrentUser().id;
    const myRoles = chat.guildId ? GuildMemberStore.getMember(chat.guildId, me)?.roles ?? [] : [];
    const names = namesIn(chat.guildId);
    const embeds = embedTexts(m.embeds ?? [], names);
    const mentions: string[] = (m.mentions ?? []).map((u: any) => typeof u === "string" ? u : u.id);
    const roles: string[] = m.mentionRoles ?? m.mention_roles ?? [];
    const edited = m.editedTimestamp ?? m.edited_timestamp;
    const reference = m.messageReference ?? m.message_reference;
    const replied = reference?.message_id
        ? m.referenced_message ?? MessageStore.getMessage(reference.channel_id ?? chat.id, reference.message_id)
        : null;
    return {
        id: m.id as string,
        autor: authorName(m.author),
        yo: m.author.id === me,
        fecha: new Date(m.timestamp).toISOString(),
        ...(edited ? { editado: new Date(edited).toISOString() } : {}),
        ...(reference?.message_id ? {
            respondeA: {
                id: reference.message_id as string,
                ...(replied?.author ? { autor: authorName(replied.author), extracto: readableMentions(replied.content ?? "", names).slice(0, MAX_EXCERPT) } : {})
            }
        } : {}),
        texto: readableMentions(m.content ?? "", names),
        ...(embeds.length ? { embeds } : {}),
        ...(m.reactions?.length ? { reacciones: m.reactions.map(reaction) } : {}),
        adjuntos: (m.attachments ?? []).map((a: any) => ({ nombre: a.filename, tipo: a.content_type ?? a.contentType, url: a.url })),
        sinLeer: isUnread(chat.id)(m),
        meMencionan: !!(m.mentionEveryone ?? m.mention_everyone) || mentions.includes(me) || roles.some(r => myRoles.includes(r))
    };
}

export async function readChat(req: ComposeRequest): Promise<ComposeResult> {
    const chat = allCandidates().find(c => c.id === req.read);
    if (!chat) return { ok: false, error: CHATS_TEXT.noChat };

    // Discord first fills the chat from its local cache (`cached`), then replaces it with the page from the network.
    const store = () => MessageStore.getMessages(chat.id);
    const fromNetwork = () => store()?.ready && !store().cached && !store().loadingMore;
    if (!fromNetwork()) {
        if (!req.fetch) return { ok: false, error: TEXT.notFetched };
        // Exactly what Discord runs on opening a chat (rule 3): one request for its usual first page of messages.
        MessageManager.fetchMessages({ guildId: chat.guildId ?? null, channelId: chat.id });
        await waitFor(fromNetwork, CONFIRM_MS);
        if (!fromNetwork()) return { ok: false, error: TEXT.fetchFailed };
    }

    const unread = isUnread(chat.id);

    // Rule 3: older pages, as scrolling up would. --more stops at the first unread message or MAX_EXTRA_PAGES;
    // --older loads that many pages, read or not, for the context of a message to write.
    const pages = req.older ?? (req.more ? MAX_EXTRA_PAGES : 0);
    let extraPages = 0;
    while (extraPages < pages && store().hasMoreBefore) {
        const oldest = store()._array[0];
        if (!oldest || (!req.older && !unread(oldest))) break;
        if (extraPages) await new Promise(r => setTimeout(r, PAGE_PAUSE_MS));
        const count = store()._array.length;
        MessageActions.fetchMessages({ channelId: chat.id, before: oldest.id, limit: PAGE_SIZE });
        await waitFor(() => !store().loadingMore && store()._array.length > count, CONFIRM_MS);
        extraPages++;
        if (store()._array.length <= count) break;
    }

    const { _array: messages, hasMoreBefore } = store();
    const { selected, unreadLoaded, rangeComplete, moreUnreadNotLoaded } = selectMessages({ messages, hasMoreBefore, isUnread: unread }, req);
    return {
        ok: true, chat: pick(chat), mensajes: selected.map(m => formatMessage(m, chat)),
        cargados: messages.length, sinLeerCargados: unreadLoaded, paginasExtra: extraPages,
        hayMasAntiguos: hasMoreBefore, rangoCompleto: rangeComplete, masSinLeerSinCargar: moreUnreadNotLoaded
    };
}

let watched = new Set<string>();
let subscribed = false;

const watchedChat = (channelId: string) => watched.has(channelId) ? allCandidates().find(c => c.id === channelId) : undefined;

/**
 * Forwards new, edited and deleted messages of the chats a `watch` listens to, in the same shape as `read`.
 * Subscribes to Discord's events only once something is watched, so nothing leaves the page otherwise.
 */
export function forwardWatchedMessages() {
    const emit = window.AgentChatBridgeNative.emitWatchEvent;
    window.AgentChatBridgeNative.onWatchChange(chatIds => {
        watched = new Set(chatIds);
        if (subscribed || !watched.size) return;
        subscribed = true;

        // Each id is announced once: a message sent from this Discord arrives as optimistic twice, first still
        // SENDING and then as the server confirmed it, and the gateway may echo it too. Deleting one's own message
        // fires MESSAGE_DELETE twice (seen in watch output).
        const firstTime = firstTimeChecker();
        FluxDispatcher.subscribe("MESSAGE_CREATE", ({ channelId, message }: any) => {
            const chat = message?.state !== "SENDING" && watchedChat(channelId);
            if (chat && firstTime(`mensaje:${message.id}`))
                emit({ evento: "mensaje", chat: pick(chat), mensaje: formatMessage(message, chat) });
        });
        // Also fires when Discord only adds a link preview; a real edit carries edited_timestamp. The update may be
        // partial, so the full message is read from the store once Discord has applied it.
        FluxDispatcher.subscribe("MESSAGE_UPDATE", ({ message }: any) => {
            const chat = message?.edited_timestamp && watchedChat(message.channel_id);
            if (!chat) return;
            setTimeout(() => {
                const full = MessageStore.getMessage(chat.id, message.id) ?? message;
                if (full.author) emit({ evento: "editado", chat: pick(chat), mensaje: formatMessage(full, chat) });
            }, 0);
        });
        FluxDispatcher.subscribe("MESSAGE_DELETE", ({ id, channelId }: any) => {
            const chat = watchedChat(channelId);
            if (chat && firstTime(`borrado:${id}`)) emit({ evento: "borrado", chat: pick(chat), id });
        });
    });
}
