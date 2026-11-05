// What the CLI changes in Discord: drafts (text, reply, attachments), and with the user's confirmation (rule 3) sends,
// edits, deletes and reactions, all under one rate limit.
import type { ComposeRequest, ComposeResult, Reaction, RequestFor } from "../ipc";
import { chatEditor, getDraft, pressEnter, replaceChatInput } from "../plugin-api/chatInput";
import {
    addReaction, ChannelRouter, ChannelStore, ComponentDispatch, DraftActions, DraftType, FluxDispatcher, MessageActions, MessageStore,
    PendingReplyStore, removeReaction, SelectedChannelStore, UploadAttachmentStore, UploadHandler, UserStore
} from "../plugin-api/discord";
import { CONFIRM_MS, waitFor } from "../plugin-api/wait";
import { allCandidates, pick, resolve, TEXT as CHATS_TEXT } from "./chats";
import type { Candidate } from "./match";
import { rateLimiter } from "./rateLimit";

/** Why a request couldn't be done, as the CLI shows it to the user. */
const TEXT = {
    noMatch: "Ningún chat encaja con ese nombre",
    ambiguous: "No hay un chat claro: elige uno de los candidatos y repite con --id",
    notOpen: "Ese chat no está abierto en Discord; deja antes el borrador con draft",
    noEditor: "No encuentro la caja de texto del chat",
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

const rateLimit = rateLimiter();

/** Leaves a draft in a chat (text, reply, attachments), or with `clear` empties its box. */
export async function draft(req: ComposeRequest): Promise<ComposeResult> {
    const { chat, candidates, searched } = resolve(req);
    if (!chat) {
        return candidates.length
            ? { ok: false, error: TEXT.ambiguous, candidatos: candidates.map(pick) }
            : { ok: false, error: req.channelId ? CHATS_TEXT.noChat : TEXT.noMatch, revisados: searched };
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
    if (!channel) return { ok: false, error: CHATS_TEXT.noChat };
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
    const draftReady = () => SelectedChannelStore.getChannelId() === chat.id && getDraft(chat.id) === text;
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
        ...(replyTo ? { respondiendo: PendingReplyStore.getPendingReply(chat.id)?.message.id === replyTo.id } : {}),
        ...(req.files?.length ? { adjuntos: UploadAttachmentStore.getUploadCount(chat.id, DraftType.ChannelMessage) } : {})
    };
}

/** The chat of a reaction, its emoji as Discord's actions take it, and whether the user's reaction is there; or why not. */
function reactionTarget({ chatId, messageId, emoji }: Reaction) {
    const chat = allCandidates().find(c => c.id === chatId);
    if (!chat) return CHATS_TEXT.noChat;
    const message = () => MessageStore.getMessage(chat.id, messageId);
    if (!message()) return TEXT.messageNotLoaded;
    const mine = () => !!message()?.reactions?.some((r: any) => r.emoji.name === emoji && r.emoji.id == null && r.me);
    return { chat, mine, unicode: { id: null, name: emoji, animated: false } };
}

/** Adds the user's reaction with a Unicode emoji, through Discord's own reaction action (rule 3: only confirmed). */
export async function react(reaction: Reaction): Promise<ComposeResult> {
    const target = reactionTarget(reaction);
    if (typeof target === "string") return { ok: false, error: target };
    const { chat, mine, unicode } = target;
    const limited = rateLimit.limited(chat.id);
    if (limited) return { ok: false, error: limited };
    rateLimit.record(chat.id);

    await addReaction(chat.id, reaction.messageId, unicode);
    await waitFor(mine, REACTION_CONFIRM_MS);
    return mine()
        ? { ok: true, chat: pick(chat), reaccionado: true }
        : { ok: false, error: TEXT.reactUnconfirmed };
}

/** Takes away the user's reaction with a Unicode emoji, as clicking it does (rule 3: only confirmed). */
export async function unreact(reaction: Reaction): Promise<ComposeResult> {
    const target = reactionTarget(reaction);
    if (typeof target === "string") return { ok: false, error: target };
    const { chat, mine, unicode } = target;
    if (!mine()) return { ok: false, error: TEXT.notReacted };
    const limited = rateLimit.limited(chat.id);
    if (limited) return { ok: false, error: limited };
    rateLimit.record(chat.id);

    await removeReaction({ channelId: chat.id, messageId: reaction.messageId, emoji: unicode });
    await waitFor(() => !mine(), REACTION_CONFIRM_MS);
    return !mine()
        ? { ok: true, chat: pick(chat), reaccionQuitada: true }
        : { ok: false, error: TEXT.unreactUnconfirmed };
}

/** One of the user's own messages that Discord has loaded, or why it can't be edited or deleted. */
function ownMessage(chatId: string, messageId: string): { chat: Candidate; message: any; } | string {
    const chat = allCandidates().find(c => c.id === chatId);
    if (!chat) return CHATS_TEXT.noChat;
    const message = MessageStore.getMessage(chat.id, messageId);
    if (!message) return TEXT.messageNotLoaded;
    if (message.author.id !== UserStore.getCurrentUser().id) return TEXT.notMine;
    return { chat, message };
}

/** Changes the text of the user's own message through Discord's edit action (rule 3: only confirmed). */
export async function edit({ chatId, messageId, text }: NonNullable<ComposeRequest["edit"]>): Promise<ComposeResult> {
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
export async function remove({ chatId, messageId }: NonNullable<ComposeRequest["delete"]>): Promise<ComposeResult> {
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

/**
 * Sends `expect` as a new message without opening the chat or touching its box, through Discord's own send action
 * (the one its chat box ends up calling). Text and an optional reply only; attachments need the box (`draft` + `send`).
 */
export async function sendDirect(req: RequestFor<"sendDirect">): Promise<ComposeResult> {
    const chat = allCandidates().find(c => c.id === req.sendDirect);
    if (!chat) return { ok: false, error: CHATS_TEXT.noChat };
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
export async function send(req: ComposeRequest): Promise<ComposeResult> {
    const chat = allCandidates().find(c => c.id === req.send);
    if (!chat) return { ok: false, error: CHATS_TEXT.noChat };
    if (SelectedChannelStore.getChannelId() !== chat.id)
        return { ok: false, error: TEXT.notOpen };

    const text = getDraft(chat.id);
    const uploads = UploadAttachmentStore.getUploadCount(chat.id, DraftType.ChannelMessage);
    if (text !== req.expect) return { ok: false, error: TEXT.draftMismatch };
    if (!text.trim() && !uploads) return { ok: false, error: TEXT.nothingToSend };
    const limited = rateLimit.limited(chat.id);
    if (limited) return { ok: false, error: limited };
    const editor = chatEditor();
    if (!editor) return { ok: false, error: TEXT.noEditor };
    rateLimit.record(chat.id);

    const before = MessageStore.getMessages(chat.id)._array.at(-1)?.id;
    editor.focus();
    pressEnter(editor);
    const me = UserStore.getCurrentUser().id;
    // Discord first shows a local copy ("SENDING", with a temporary id) and swaps in the server's once accepted.
    const sentMessage = () => {
        const last = MessageStore.getMessages(chat.id)._array.at(-1);
        return last && last.id !== before && last.author.id === me ? last : null;
    };
    await waitFor(() => sentMessage()?.state === "SENT" || sentMessage()?.state === "SEND_FAILED", CONFIRM_MS);
    const sent = sentMessage();
    if (sent?.state === "SENT") return { ok: true, chat: pick(chat), enviado: true, id: sent.id };
    return { ok: false, error: sent?.state === "SEND_FAILED" ? TEXT.sendFailed : TEXT.sendUnconfirmed };
}
