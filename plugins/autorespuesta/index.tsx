import { ChatBarButton, type ChatBarButtonFactory } from "@plugin-api/chatButtons";
import { MessageStore, showToast, UserStore } from "@plugin-api/discord";
import type { Message } from "@plugin-api/discordTypes";
import definePlugin, { OptionType } from "@plugin-api/plugin";
import { definePluginSettings } from "@plugin-api/settings";

import { askClaude, getDraft, replaceChatInput, SparklesIcon } from "../shared";
import style from "./styles.css";
import { buildTranscript, displayName } from "./transcript";

const DEFAULT_PROMPT = `Escribe mi siguiente mensaje en la conversación de chat que hay entre <conversación> y </conversación>.
Mi nombre en el chat va entre <yo> y </yo>, y mis mensajes llevan la marca (yo). Escribe solo como yo, nunca como los demás participantes.
La conversación termina con una línea mía vacía: ese es el mensaje que tienes que escribir, respondiendo a lo anterior.
Escríbelo como lo haría yo, con naturalidad: mismo registro y longitud parecida. No exageres mi estilo ni metas muletillas que no vengan a cuento.
Si hay mensajes entre <ejemplos> y </ejemplos>, son mensajes míos anteriores: úsalos solo para imitar cómo escribo, no su contenido.
Si hay texto entre <guía> y </guía>, es una pista vaga de lo que quiero responder (por ejemplo «no», «sí», «bien», «mal»): escribe el mensaje que desarrolla esa idea, sin contradecirla.
Responde en el idioma de la conversación. No inventes datos que no aparezcan en ella.
Devuelve solo el texto del mensaje, sin comillas, nombre ni explicaciones.`;

const settings = definePluginSettings({
    prompt: {
        type: OptionType.STRING,
        multiline: true,
        description: "Prompt de la autorespuesta",
        default: DEFAULT_PROMPT
    },
    styleNotes: {
        type: OptionType.STRING,
        multiline: true,
        description: "Notas sobre tu forma de escribir (opcional, se añaden al prompt)",
        default: ""
    },
    examples: {
        type: OptionType.NUMBER,
        description: "Cuántos mensajes tuyos anteriores (ya cargados) enviar como ejemplos de tono; 0 para ninguno",
        default: 20
    },
    model: {
        type: OptionType.STRING,
        description: "Modelo de Claude",
        default: "claude-sonnet-5-5"
    }
});

/**
 * Uses only messages Discord already has loaded, from the chosen one to the latest. Whatever is in the chat box
 * guides the reply and is replaced by it; nothing is sent.
 */
async function generateFrom(channelId: string, messageId: string) {
    const messages: Message[] = MessageStore.getMessages(channelId)._array;
    const start = messages.findIndex(m => m.id === messageId);
    if (start < 0) {
        showToast({ text: "Ese mensaje no está cargado", variant: "critical" });
        return;
    }

    const { prompt, styleNotes, examples, model } = settings.store;
    const systemPrompt = styleNotes.trim() ? `${prompt}\n\nNotas sobre mi forma de escribir:\n${styleNotes}` : prompt;

    const me = UserStore.getCurrentUser();
    const ownBefore = examples > 0
        ? messages.slice(0, start).filter(m => m.author.id === me.id && m.content).slice(-examples)
        : [];
    const examplesBlock = ownBefore.length ? `<ejemplos>\n${ownBefore.map(m => m.content).join("\n")}\n</ejemplos>\n\n` : "";
    const draft = getDraft(channelId);
    const guideBlock = draft?.trim() ? `\n\n<guía>\n${draft}\n</guía>` : "";
    const input = `<yo>${displayName(me)}</yo>\n\n${examplesBlock}<conversación>\n${buildTranscript(messages.slice(start), me)}\n</conversación>${guideBlock}`;

    const reply = await askClaude(systemPrompt, input, model);
    if (reply == null) return;
    if (getDraft(channelId) !== draft) {
        showToast({ text: "El texto cambió mientras se generaba; no lo toco", variant: "critical" });
        return;
    }
    replaceChatInput(reply);
}

let stopSelection: (() => void) | null = null;

/** Waits for a click on a message of the channel; Escape or a second press of the button cancels. */
function toggleSelection(channelId: string) {
    if (stopSelection) return stopSelection();

    const prefix = `chat-messages-${channelId}-`;
    const onClick = (e: MouseEvent) => {
        const el = (e.target as HTMLElement).closest(`[id^="${prefix}"]`);
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        stop();
        generateFrom(channelId, el.id.slice(prefix.length));
    };
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") stop();
    };
    function stop() {
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKeyDown, true);
        document.body.classList.remove("dm-autoreply-selecting");
        stopSelection = null;
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.body.classList.add("dm-autoreply-selecting");
    stopSelection = stop;
    showToast({ text: "Haz clic en el mensaje desde el que empezar (Esc para cancelar)" });
}

const AutorespuestaChatBarButton: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    if (!isMainChat) return null;

    return (
        <ChatBarButton tooltip="Generar respuesta" onClick={() => toggleSelection(channel.id)}>
            <SparklesIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "Autorespuesta",
    description: "Genera en la caja de texto una respuesta con tu tono a partir del mensaje que elijas; lo que hubiera en la caja sirve de guía.",
    settings,
    style,

    chatBarButton: {
        icon: SparklesIcon,
        render: AutorespuestaChatBarButton
    },

    messagePopoverButton: {
        icon: SparklesIcon,
        render(message: Message) {
            return {
                label: "Generar respuesta desde aquí",
                icon: SparklesIcon,
                onClick: () => generateFrom(message.channel_id, message.id)
            };
        }
    },

    stop() {
        stopSelection?.();
    }
});
