import { ChatBarButton, type ChatBarButtonFactory } from "@plugin-api/chatButtons";
import { getDraft, pressEnter, replaceChatInput } from "@plugin-api/chatInput";
import { DraftType, MessageActions, MessageStore, SelectedChannelStore, showToast, UploadAttachmentStore, UserStore } from "@plugin-api/discord";
import type { Message } from "@plugin-api/discordTypes";
import definePlugin, { OptionType } from "@plugin-api/plugin";
import { definePluginSettings } from "@plugin-api/settings";
import { CONFIRM_MS, waitFor } from "@plugin-api/wait";

import { askClaude, reportFailure, SpellcheckIcon } from "../shared";
import { keepOriginalCase, rewritten } from "./text";

const DEFAULT_PROMPT = `Eres un corrector ortográfico mínimo. Recibes un mensaje de chat entre <mensaje> y </mensaje> y lo devuelves casi literal.
Corrige solo faltas flagrantes: b/v, g/j, h que falta o sobra, tildes que faltan, letras cambiadas y espacios que sobran, faltan o se han corrido de sitio.
El fallo más frecuente es un espacio corrido una letra: la última letra de una palabra pasa a la siguiente o al revés, por ejemplo «s epodria» en vez de «se podría», «y averemos» en vez de «ya veremos», «vemo sluego» en vez de «vemos luego» o «qu edamos» en vez de «quedamos».
Si una palabra no existe o no encaja, prueba primero a mover ese espacio con las de al lado y quédate con lo que tenga sentido en la frase. Nunca quites ni añadas letras o palabras para arreglarlo: si un trozo parece sobrar, únelo a la palabra de al lado.
Después pon las tildes que falten a las palabras resultantes.
Prohibido: cambiar mayúsculas/minúsculas, tocar la puntuación, cambiar palabras correctas, emojis, enlaces, menciones o cualquier cosa entre < >. No reformules ni mejores el estilo.
Conserva el idioma original. En caso de duda, no corrijas.
Devuelve solo el mensaje corregido, sin las etiquetas, comillas ni explicaciones.`;

const settings = definePluginSettings({
    prompt: {
        type: OptionType.STRING,
        multiline: true,
        description: "Prompt del corrector",
        default: DEFAULT_PROMPT
    },
    model: {
        type: OptionType.STRING,
        description: "Modelo de Claude",
        // Haiku merges or drops misplaced-space words («s epodria» → «sepodría», «di je» → «di»); Sonnet takes as long.
        default: "claude-sonnet-5-5"
    },
    enterCorrectsLast: {
        type: OptionType.BOOLEAN,
        description: "Enter con la caja vacía corrige tu último mensaje enviado, sin confirmación",
        default: true
    }
});

/** The button's name and the toasts, as the user sees them. */
const TEXT = {
    action: "Corregir ortografía",
    nothingToFix: "Sin faltas que corregir",
    tooMuch: "La corrección cambiaba demasiado el mensaje; descartada",
    changedWhileFixing: "El texto cambió mientras se corregía; no lo toco",
    changedBeforeSending: "El texto cambió mientras se corregía; no lo envío",
    fixed: "Mensaje corregido",
    editUnconfirmed: "Discord no confirmó la corrección; revisa el mensaje"
} as const;

/** Model answers per correction: a second one when the first rewrote the message ("s epodria" → "Es posible"). */
const ATTEMPTS = 2;

/** Returns the corrected text, or null when there is nothing to apply (a toast explains why). */
async function correct(text: string) {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        // The text goes in unescaped, since the model must return it as it is. Text that closes <mensaje> and asks for
        // something else gets an answer that changes words, which rewritten() discards.
        const raw = await askClaude(settings.store.prompt, `<mensaje>\n${text}\n</mensaje>`, settings.store.model);
        if (raw == null) return null;

        const fixed = keepOriginalCase(text, raw.replace(/^<mensaje>\s*|\s*<\/mensaje>$/g, ""));
        if (fixed === text) {
            showToast({ text: TEXT.nothingToFix, variant: "success" });
            return null;
        }
        if (!rewritten(text, fixed)) return fixed;
    }
    showToast({ text: TEXT.tooMuch, variant: "critical" });
    return null;
}

/** Corrects the draft in the box, unless it changes meanwhile. */
async function correctDraft(channelId: string) {
    const draft = getDraft(channelId);
    if (!draft.trim()) return;

    const fixed = await correct(draft);
    if (fixed == null) return;
    if (getDraft(channelId) !== draft) {
        showToast({ text: TEXT.changedWhileFixing, variant: "critical" });
        return;
    }
    await replaceChatInput(fixed);
}

const CorrectorChatBarButton: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    if (!isMainChat) return null;

    return (
        <ChatBarButton tooltip={TEXT.action} onClick={() => correctDraft(channel.id).catch(reportFailure)}>
            <SpellcheckIcon />
        </ChatBarButton>
    );
};

/** Edits an own sent message in place; the click on its button or the Enter is the confirmation. */
async function correctSentMessage(message: Message) {
    const fixed = await correct(message.content);
    if (fixed == null) return;
    await MessageActions.editMessage(message.channel_id, message.id, { content: fixed });
    // Discord queues the edit and doesn't wait for it; the store has the new text once the server accepts it.
    const edited = () => MessageStore.getMessage(message.channel_id, message.id)?.content === fixed;
    await waitFor(edited, CONFIRM_MS);
    showToast(edited() ? { text: TEXT.fixed, variant: "success" } : { text: TEXT.editUnconfirmed, variant: "critical" });
}

/** Corrects the last own message. Triggered by Enter on an empty box, which Discord ignores. */
async function correctLastMessage(channelId: string) {
    // Discord has no current user until the session is up.
    const myId = UserStore.getCurrentUser()?.id;
    const last = MessageStore.getMessages(channelId)._array.findLast((m: Message) => m.author.id === myId && m.content);
    if (last) await correctSentMessage(last);
}

/**
 * Ctrl+Enter: corrects the draft, then sends it through Discord's own Enter handling, so replies, mentions and
 * emoji parsing behave as usual. If the correction fails or is discarded, the original text is sent.
 */
async function correctAndSend(channelId: string, draft: string, editor: HTMLElement) {
    const fixed = await correct(draft);
    if (getDraft(channelId) !== draft) {
        showToast({ text: TEXT.changedBeforeSending, variant: "critical" });
        return;
    }
    if (fixed != null) {
        await replaceChatInput(fixed);
        await waitFor(() => getDraft(channelId) === fixed, 500);
    }
    pressEnter(editor);
}

let busy = false;

async function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.metaKey || e.isComposing || e.repeat) return;

    // The edit box of a sent message is also a Slate editor, but it lives inside the message element.
    const target = e.target as HTMLElement;
    const editor = target.closest<HTMLElement>('[data-slate-editor="true"]');
    if (!editor || target.closest('[id^="chat-messages-"]')) return;

    const channelId = SelectedChannelStore.getChannelId();
    const draft = getDraft(channelId);
    let task: Promise<void>;

    if (e.ctrlKey) {
        if (!draft.trim()) return;
        // Stop Discord from handling Ctrl+Enter before the correction lands.
        e.preventDefault();
        e.stopImmediatePropagation();
        if (busy) return;
        task = correctAndSend(channelId, draft, editor);
    } else {
        if (busy || !settings.store.enterCorrectsLast || draft.trim()) return;
        if (UploadAttachmentStore.getUploadCount(channelId, DraftType.ChannelMessage)) return;
        task = correctLastMessage(channelId);
    }

    busy = true;
    try {
        await task;
    } catch (err) {
        reportFailure(err);
    } finally {
        busy = false;
    }
}

export default definePlugin({
    name: "Corrector",
    description: "Corrige faltas de ortografía flagrantes antes de enviar (botón o Ctrl+Enter) o después (tus mensajes).",
    settings,

    chatBarButton: {
        icon: SpellcheckIcon,
        render: CorrectorChatBarButton
    },

    messagePopoverButton: {
        icon: SpellcheckIcon,
        render(message: Message) {
            if (!message.content || message.author.id !== UserStore.getCurrentUser()?.id) return null;

            return {
                label: TEXT.action,
                icon: SpellcheckIcon,
                onClick: () => correctSentMessage(message).catch(reportFailure)
            };
        }
    },

    start() {
        document.addEventListener("keydown", onKeyDown, true);
    }
});
