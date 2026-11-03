// Answers scripts/discord-mod.mjs: drafts (text, reply, attachments), lists chats and unread ones, reads a chat, and
// sends, edits, deletes or reacts. Requests to Discord's API beyond what the user's own actions make are limited by
// rule 3: `read --fetch` (one page, as opening a chat), `read --more` and `read --older` (up to 3 older pages), `send`,
// `edit`, `delete` and `react`.
import { type Command, commandOf, type ComposeCandidate, type ComposeRequest, type ComposeResult, type RequestFor } from "../ipc";
import { MAX_EXTRA_PAGES } from "../limits.mts";
import { chatEditor, getDraft, pressEnter, replaceChatInput } from "../plugin-api/chatInput";
import {
    ActiveJoinedThreadsStore, addReaction, ChannelRouter, ChannelStore, ComponentDispatch, DraftActions, DraftType, FluxDispatcher, GuildMemberStore,
    GuildRoleStore, GuildStore,
    MessageActions, MessageManager, MessageStore, PendingReplyStore, PermissionStore, ReadStateStore, RelationshipStore, removeReaction,
    SelectedChannelStore, UploadAttachmentStore, UploadHandler, UserGuildSettingsStore, UserStore
} from "../plugin-api/discord";
import { CONFIRM_MS, waitFor } from "../plugin-api/wait";
import { firstTimeChecker } from "./dedupe";
import { embedTexts, type Names, reaction, readableMentions } from "./format";
import { byRecency, type Candidate, fold, inRange, match, selectMessages, snowflakeTime } from "./match";
import { rateLimiter } from "./rateLimit";

/** Why a request couldn't be done, as the CLI shows it to the user. */
const TEXT = {
    noChat: "No encuentro ese chat",
    noMatch: "Ningún chat encaja con ese nombre",
    ambiguous: "No hay un chat claro: elige uno de los candidatos y repite con --id",
    notOpen: "Ese chat no está abierto en Discord; deja antes el borrador con draft",
    noEditor: "No encuentro la caja de texto del chat",
    notFetched: "Discord no tiene cargados los mensajes de ese chat; repite con --fetch",
    fetchFailed: "Discord no cargó los mensajes de ese chat",
    messageNotLoaded: "Ese mensaje no está cargado en ese chat; cárgalo antes con read --fetch",
    notMine: "Ese mensaje no es del usuario",
    draftExists: "Ese chat ya tiene un borrador o adjuntos; repite con --replace para sustituirlo",
    notCleared: "Discord no vació la caja de ese chat",
    draftMismatch: "El borrador de la caja no es el texto confirmado; no envío nada",
    nothingToSend: "No hay nada que enviar",
    sendFailed: "Discord no pudo enviar el mensaje",
    sendUnconfirmed: "Discord no confirmó el envío; revisa el chat",
    sameText: "El mensaje ya tiene ese texto",
    editUnconfirmed: "Discord no confirmó la edición; revisa el mensaje",
    deleteUnconfirmed: "Discord no confirmó el borrado; revisa el chat",
    notReacted: "El usuario no ha reaccionado con ese emoji a ese mensaje",
    reactUnconfirmed: "Discord no confirmó la reacción; revisa el mensaje",
    unreactUnconfirmed: "Discord no confirmó que se quitara la reacción; revisa el mensaje"
} as const;

/** How long the chat box gets to show a draft, an emptied box or attachments, which happen without the server. */
const BOX_UPDATE_MS = 3000;
/** How long Discord gets to show an added or removed reaction. */
const REACTION_CONFIRM_MS = 5000;

const TEXT_CHANNEL_TYPES = new Set([0, 5]); // text and announcement
const VIEW_CHANNEL = 1n << 10n;

const userName = (id: string | undefined) => {
    const user = id && UserStore.getUser(id);
    return user ? [RelationshipStore.getNickname(id), user.globalName, user.username].filter((n): n is string => !!n) : [];
};

function allCandidates(): Candidate[] {
    const list: Candidate[] = [];
    for (const ch of ChannelStore.getSortedPrivateChannels()) {
        if (ch.isDM()) {
            // A DM always has its other person; without one the chat would still show, under its id.
            const names = userName(ch.getRecipientId());
            list.push({ id: ch.id, kind: "dm", label: names[0] ?? ch.id, names, lastMessageId: ch.lastMessageId ?? "0" });
        } else if (ch.isGroupDM()) {
            const members = ch.recipients.flatMap(id => userName(id).slice(0, 1));
            list.push({ id: ch.id, kind: "grupo", label: ch.name || members.join(", "), names: ch.name ? [ch.name] : [], weak: members, lastMessageId: ch.lastMessageId ?? "0" });
        }
    }
    for (const guild of Object.values(GuildStore.getGuilds())) {
        for (const id of ChannelStore.getChannelIds(guild.id)) {
            const ch = ChannelStore.getChannel(id);
            // Discord also knows the channels the user can't see (named "___hidden___"); skip those.
            if (!ch || !TEXT_CHANNEL_TYPES.has(ch.type) || !PermissionStore.can(VIEW_CHANNEL, ch)) continue;
            list.push({ id, kind: "canal", label: `#${ch.name} · ${guild.name}`, names: [ch.name, `${guild.name} ${ch.name}`], lastMessageId: ch.lastMessageId ?? "0", guildId: guild.id });
        }
        for (const threads of Object.values(ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guild.id)))
            for (const { channel: th } of Object.values(threads)) {
                const parent = (th.parent_id && ChannelStore.getChannel(th.parent_id)?.name) ?? "";
                list.push({ id: th.id, kind: "hilo", label: `${th.name} · #${parent} · ${guild.name}`, names: [th.name, `${guild.name} ${th.name}`], lastMessageId: th.lastMessageId ?? "0", guildId: guild.id });
            }
    }
    return list;
}

const pick = ({ id, kind, label }: Candidate): ComposeCandidate => ({ id, kind, label });

/** The chat by id or by name (see `match`), and how many chats of each kind were searched. */
function resolve(req: ComposeRequest): { chat?: Candidate; candidates: Candidate[]; searched: Record<Candidate["kind"], number>; } {
    const all = allCandidates();
    const searched = { dm: 0, grupo: 0, canal: 0, hilo: 0 };
    for (const c of all) searched[c.kind]++;
    if (req.channelId) {
        const chat = all.find(c => c.id === req.channelId);
        return chat ? { chat, candidates: [], searched } : { candidates: [], searched };
    }
    if (req.query === undefined) throw new Error("[discord-mod] A draft names its chat by id or by name; validate.ts checks it");
    return { ...match(all, req.query), searched };
}

/** Whether the chat's last message falls in the requested range; always true without one. */
const activeIn = (c: Candidate, req: ComposeRequest) =>
    (req.since == null && req.until == null) || (c.lastMessageId !== "0" && inRange(snowflakeTime(c.lastMessageId), req));

/** Kinds, server name (folded substring) and activity range, as `list` and `unread` filter them. */
const wanted = (c: Candidate, req: ComposeRequest) =>
    (!req.kinds?.length || req.kinds.includes(c.kind))
    && (!req.server || (c.guildId != null && fold(GuildStore.getGuild(c.guildId)?.name ?? "").includes(fold(req.server))))
    && activeIn(c, req);

/** Every wanted chat, most recent first. */
function listChats(req: ComposeRequest): ComposeCandidate[] {
    return allCandidates()
        .filter(c => wanted(c, req))
        .sort(byRecency)
        .map(pick);
}

/** Every chat with unread messages active in the range, muted ones included and flagged. */
function unreadChats(req: ComposeRequest) {
    return allCandidates()
        .filter(c => wanted(c, req) && ReadStateStore.hasUnread(c.id))
        .sort(byRecency)
        .map(c => ({
            ...pick(c),
            mensajes: ReadStateStore.getUnreadCount(c.id),
            menciones: ReadStateStore.getMentionCount(c.id),
            silenciado: c.guildId != null
                ? UserGuildSettingsStore.isGuildOrCategoryOrChannelMuted(c.guildId, c.id)
                : UserGuildSettingsStore.isChannelMuted(null, c.id)
        }));
}

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

async function readChat(req: ComposeRequest): Promise<ComposeResult> {
    const chat = allCandidates().find(c => c.id === req.read);
    if (!chat) return { ok: false, error: TEXT.noChat };

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

/** Each command's handler; the compiler asks for one per command of ipc.ts. */
const HANDLERS: { [C in Command]: (req: RequestFor<C>) => Promise<ComposeResult> } = {
    list: async req => ({ ok: true, chats: listChats(req) }),
    unread: async req => ({ ok: true, sinLeer: unreadChats(req) }),
    read: readChat,
    send,
    react: req => react(req.react),
    edit: req => edit(req.edit),
    delete: req => remove(req.delete),
    draft
};

export function compose(req: ComposeRequest): Promise<ComposeResult> {
    // commandOf only names a command whose key the request has, which is what that handler's type asks for.
    return (HANDLERS[commandOf(req)] as (req: ComposeRequest) => Promise<ComposeResult>)(req);
}

/** Leaves a draft in a chat (text, reply, attachments), or with `clear` empties its box. */
async function draft(req: ComposeRequest): Promise<ComposeResult> {
    const { chat, candidates, searched } = resolve(req);
    if (!chat) {
        return candidates.length
            ? { ok: false, error: TEXT.ambiguous, candidatos: candidates.map(pick) }
            : { ok: false, error: req.channelId ? TEXT.noChat : TEXT.noMatch, revisados: searched };
    }
    if (req.dryRun) return { ok: true, chat: pick(chat), abierto: false, borradorCargado: false };
    if (req.clear) {
        // The open chat's box ignores stored drafts; any other chat just gets an empty one, without opening it.
        if (SelectedChannelStore.getChannelId() === chat.id) await replaceChatInput("");
        else DraftActions.saveDraft(chat.id, "", DraftType.ChannelMessage);
        const empty = () => !getDraft(chat.id);
        await waitFor(empty, BOX_UPDATE_MS);
        return empty() ? { ok: true, chat: pick(chat), vaciado: true } : { ok: false, error: TEXT.notCleared };
    }
    if ((getDraft(chat.id) || UploadAttachmentStore.getUploadCount(chat.id, DraftType.ChannelMessage)) && !req.replace)
        return { ok: false, error: TEXT.draftExists, candidatos: [pick(chat)] };

    const channel = ChannelStore.getChannel(chat.id);
    if (!channel) return { ok: false, error: TEXT.noChat };
    const replyTo = req.replyTo ? MessageStore.getMessage(chat.id, req.replyTo) : null;
    if (req.replyTo && !replyTo)
        return { ok: false, error: TEXT.messageNotLoaded };

    const text = req.text ?? "";
    // The open chat's box is already mounted and ignores stored drafts; any other chat loads its draft when opened.
    if (SelectedChannelStore.getChannelId() === chat.id) await replaceChatInput(text);
    else {
        DraftActions.saveDraft(chat.id, text, DraftType.ChannelMessage);
        ChannelRouter.transitionToChannel(chat.id);
    }
    const draftReady = () => SelectedChannelStore.getChannelId() === chat.id && (getDraft(chat.id) ?? "") === text;
    await waitFor(draftReady, BOX_UPDATE_MS);

    if (replyTo) {
        FluxDispatcher.dispatch({
            type: "CREATE_PENDING_REPLY",
            channel,
            message: replyTo,
            shouldMention: true,
            showMentionToggle: channel.guild_id != null
        });
    }
    if (req.files?.length) {
        const files = req.files.map(f => new File([f.data as BlobPart], f.name, { type: f.type }));
        UploadHandler.promptToUpload(files, channel, DraftType.ChannelMessage);
        await waitFor(() => UploadAttachmentStore.getUploadCount(chat.id, DraftType.ChannelMessage) >= files.length, BOX_UPDATE_MS);
    }
    ComponentDispatch.dispatchToLastSubscribed("TEXTAREA_FOCUS");

    return {
        ok: true,
        chat: pick(chat),
        abierto: SelectedChannelStore.getChannelId() === chat.id,
        borradorCargado: draftReady(),
        ...(replyTo ? { respondiendo: PendingReplyStore.getPendingReply(chat.id)?.message?.id === replyTo.id } : {}),
        ...(req.files?.length ? { adjuntos: UploadAttachmentStore.getUploadCount(chat.id, DraftType.ChannelMessage) } : {})
    };
}

/**
 * Adds or removes the user's reaction with a Unicode emoji, through Discord's own reaction actions (rule 3: only
 * confirmed).
 */
async function react({ chatId, messageId, emoji, remove }: NonNullable<ComposeRequest["react"]>): Promise<ComposeResult> {
    const chat = allCandidates().find(c => c.id === chatId);
    if (!chat) return { ok: false, error: TEXT.noChat };
    const message = () => MessageStore.getMessage(chat.id, messageId);
    if (!message()) return { ok: false, error: TEXT.messageNotLoaded };
    const mine = () => !!message()?.reactions?.some((r: any) => r.emoji.name === emoji && r.emoji.id == null && r.me);
    if (remove && !mine()) return { ok: false, error: TEXT.notReacted };
    const limited = rateLimit.limited(chat.id);
    if (limited) return { ok: false, error: limited };
    rateLimit.record(chat.id);

    const unicode = { id: null, name: emoji, animated: false };
    if (remove) {
        await removeReaction({ channelId: chat.id, messageId, emoji: unicode });
        await waitFor(() => !mine(), REACTION_CONFIRM_MS);
        return !mine()
            ? { ok: true, chat: pick(chat), reaccionQuitada: true }
            : { ok: false, error: TEXT.unreactUnconfirmed };
    }
    await addReaction(chat.id, messageId, unicode);
    await waitFor(mine, REACTION_CONFIRM_MS);
    return mine()
        ? { ok: true, chat: pick(chat), reaccionado: true }
        : { ok: false, error: TEXT.reactUnconfirmed };
}

/** One of the user's own messages that Discord has loaded, or why it can't be edited or deleted. */
function ownMessage(chatId: string, messageId: string): { chat: Candidate; message: any; } | string {
    const chat = allCandidates().find(c => c.id === chatId);
    if (!chat) return TEXT.noChat;
    const message = MessageStore.getMessage(chat.id, messageId);
    if (!message) return TEXT.messageNotLoaded;
    if (message.author.id !== UserStore.getCurrentUser().id) return TEXT.notMine;
    return { chat, message };
}

/** Changes the text of the user's own message through Discord's edit action (rule 3: only confirmed). */
async function edit({ chatId, messageId, text }: NonNullable<ComposeRequest["edit"]>): Promise<ComposeResult> {
    const own = ownMessage(chatId, messageId);
    if (typeof own === "string") return { ok: false, error: own };
    if (own.message.content === text) return { ok: false, error: TEXT.sameText };
    const limited = rateLimit.limited(own.chat.id);
    if (limited) return { ok: false, error: limited };
    rateLimit.record(own.chat.id);

    // Discord queues the edit and doesn't wait for it; the store has the new text once the server accepts it.
    await MessageActions.editMessage(own.chat.id, messageId, { content: text });
    const edited = () => MessageStore.getMessage(own.chat.id, messageId)?.content === text;
    await waitFor(edited, CONFIRM_MS);
    return edited()
        ? { ok: true, chat: pick(own.chat), editado: true }
        : { ok: false, error: TEXT.editUnconfirmed };
}

/** Deletes the user's own message for everyone, through Discord's delete action (rule 3: only confirmed). */
async function remove({ chatId, messageId }: NonNullable<ComposeRequest["delete"]>): Promise<ComposeResult> {
    const own = ownMessage(chatId, messageId);
    if (typeof own === "string") return { ok: false, error: own };
    const limited = rateLimit.limited(own.chat.id);
    if (limited) return { ok: false, error: limited };
    rateLimit.record(own.chat.id);

    // Discord doesn't wait for the request either; the message leaves the store once the server deletes it.
    await MessageActions.deleteMessage(own.chat.id, messageId);
    const deleted = () => !MessageStore.getMessage(own.chat.id, messageId);
    await waitFor(deleted, CONFIRM_MS);
    return deleted()
        ? { ok: true, chat: pick(own.chat), borrado: true }
        : { ok: false, error: TEXT.deleteUnconfirmed };
}

let watched = new Set<string>();
let subscribed = false;

const watchedChat = (channelId: string) => watched.has(channelId) ? allCandidates().find(c => c.id === channelId) : undefined;

/**
 * Forwards new, edited and deleted messages of the chats a `watch` listens to, in the same shape as `read`.
 * Subscribes to Discord's events only once something is watched, so nothing leaves the page otherwise.
 */
export function forwardWatchedMessages() {
    const emit = window.DiscordModNative.emitWatchEvent;
    window.DiscordModNative.onWatchChange(chatIds => {
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

const rateLimit = rateLimiter();

/**
 * Sends `expect` as a new message without opening the chat or touching its box, through Discord's own send action
 * (the one its chat box ends up calling). Text and an optional reply only; attachments need the box (`draft` + `send`).
 */
async function sendDirect(chat: Candidate, req: ComposeRequest): Promise<ComposeResult> {
    const text = req.expect ?? "";
    if (!text.trim()) return { ok: false, error: TEXT.nothingToSend };
    const replyTo = req.replyTo ? MessageStore.getMessage(chat.id, req.replyTo) : null;
    if (req.replyTo && !replyTo) return { ok: false, error: TEXT.messageNotLoaded };
    const limited = rateLimit.limited(chat.id);
    if (limited) return { ok: false, error: limited };
    rateLimit.record(chat.id);

    const options = replyTo
        ? MessageActions.getSendMessageOptionsForReply({ channel: ChannelStore.getChannel(chat.id), message: replyTo, shouldMention: true })
        : {};
    try {
        // false: send now even if the chat's messages aren't loaded. With true Discord queues it until something loads
        // the chat, and it would go out after the CLI has already reported a timeout.
        const response = await MessageActions.sendMessage(
            chat.id, { content: text, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, false, options
        );
        const id = response?.body?.id;
        return id
            ? { ok: true, chat: pick(chat), enviado: true, id }
            : { ok: false, error: TEXT.sendUnconfirmed };
    } catch (err) {
        return { ok: false, error: `${TEXT.sendFailed}: ${err}` };
    }
}


/**
 * Sends what is in the chat box, by pressing Enter in it as the user would, so replies, attachments and mentions go
 * through Discord's own path. Only when the box holds exactly `expect`, the text the user saw and confirmed (rule 3).
 */
async function send(req: ComposeRequest): Promise<ComposeResult> {
    const chat = allCandidates().find(c => c.id === req.send);
    if (!chat) return { ok: false, error: TEXT.noChat };
    if (req.direct) return sendDirect(chat, req);
    if (SelectedChannelStore.getChannelId() !== chat.id)
        return { ok: false, error: TEXT.notOpen };

    const text = getDraft(chat.id) ?? "";
    const uploads = UploadAttachmentStore.getUploadCount(chat.id, DraftType.ChannelMessage);
    if (text !== req.expect) return { ok: false, error: TEXT.draftMismatch };
    if (!text.trim() && !uploads) return { ok: false, error: TEXT.nothingToSend };
    const limited = rateLimit.limited(chat.id);
    if (limited) return { ok: false, error: limited };
    const editor = chatEditor();
    if (!editor) return { ok: false, error: TEXT.noEditor };
    rateLimit.record(chat.id);

    const before = MessageStore.getMessages(chat.id)?._array?.at(-1)?.id;
    editor.focus();
    pressEnter(editor);
    const me = UserStore.getCurrentUser().id;
    // Discord first shows a local copy ("SENDING", with a temporary id) and swaps in the server's once accepted.
    const sentMessage = () => {
        const last = MessageStore.getMessages(chat.id)?._array?.at(-1);
        return last && last.id !== before && last.author.id === me ? last : null;
    };
    await waitFor(() => sentMessage()?.state === "SENT" || sentMessage()?.state === "SEND_FAILED", CONFIRM_MS);
    const sent = sentMessage();
    if (sent?.state === "SENT") return { ok: true, chat: pick(chat), enviado: true, id: sent.id };
    return { ok: false, error: sent?.state === "SEND_FAILED" ? TEXT.sendFailed : TEXT.sendUnconfirmed };
}
