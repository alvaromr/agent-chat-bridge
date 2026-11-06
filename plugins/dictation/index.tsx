// Dictation into the chat box with a local Whisper model (dictation/): the microphone button, or holding Space in the
// box as in Claude Code. The text appears phrase by phrase and is never sent: the user sends it with Enter.
import { ChatBarButton, type ChatBarButtonFactory } from "@plugin-api/chatButtons";
import { DRAFT_SHOWN_MS, getDraft, insertTextIntoChatInputBox, replaceChatInput } from "@plugin-api/chatInput";
import { SelectedChannelStore, showToast, useEffect, useState } from "@plugin-api/discord";
import { log } from "@plugin-api/log";
import definePlugin, { type IconComponent, OptionType } from "@plugin-api/plugin";
import { definePluginSettings } from "@plugin-api/settings";
import { waitFor } from "@plugin-api/wait";

import { restyle } from "../../dictation/src/style";
import { parseWords } from "../../dictation/src/vocabulary";
import { reportFailure } from "../shared";
import { type Capture, startCapture } from "./capture";
import type { DictationEvent } from "./main";
import { IDLE, type SpaceAction, spaceDown, type SpaceState, spaceUp, TYPED } from "./space";
import style from "./styles.css";
import { compose, withoutTypedSpaces } from "./text";

const native = () => window.AgentChatBridgeNative.dictation;

const settings = definePluginSettings({
    model: {
        type: OptionType.STRING,
        description: "Modelo de Whisper, entre los descargados en formato MLX",
        // Measured on the user's voice: as accurate as whisper medium and as fast as Parakeet.
        default: "mlx-community/whisper-large-v3-turbo",
        options: () => native().models()
    },
    language: {
        type: OptionType.STRING,
        description: "Idioma en el que dictas (código de dos letras)",
        default: "es"
    },
    vocabulary: {
        type: OptionType.STRING,
        multiline: true,
        description: "Palabras que dices y Whisper debe reconocer, separadas por comas",
        default: "git, commit, push, pre-push, rebase, pull request, merge, bug, fix, toast, lint, typecheck, coverage, Claude, Claude Code, skill, CLI, acb, pnpm, Vitest, Stryker, daily, Slack, Jira, endpoint, API, TypeScript, staging, Parakeet, sherpa-onnx, Whisper, Electron, hook, webpack, Discord, worktree, checkout, merge conflict, package.json, squash, build, smoke test, changelog, release, backend"
    },
    replacements: {
        type: OptionType.STRING,
        multiline: true,
        description: "Lo que aún entienda mal, una sustitución por línea: «oído => querido»",
        // What Whisper still wrote, with the vocabulary, on the user's recordings.
        default: "Griscord => Discord\nWorldtree => worktree"
    },
    noFinalPeriod: {
        type: OptionType.BOOLEAN,
        description: "Quitar el punto final del texto dictado (los de en medio se quedan)",
        default: false
    },
    noSentenceCapitals: {
        type: OptionType.BOOLEAN,
        description: "Empezar cada frase en minúscula, salvo las palabras que el vocabulario escribe con mayúscula",
        default: false
    },
    noOpeningMarks: {
        type: OptionType.BOOLEAN,
        description: "No poner «¿» ni «¡» al abrir preguntas y exclamaciones",
        default: true
    },
    holdSpace: {
        type: OptionType.BOOLEAN,
        description: "Mantener Espacio en la caja de texto dicta, y soltarlo para",
        default: true
    }
});

type Phase = "idle" | "warming" | "listening" | "finishing";

/** The button's name in each phase, and the toasts. */
const TEXT = {
    phase: {
        idle: "Dictar (o mantén Espacio)",
        warming: "Abriendo el micrófono…",
        listening: "Dictando: pulsa para parar, Escape cancela",
        finishing: "Terminando de transcribir…"
    } satisfies Record<Phase, string>,
    failed: (error: string) => `Dictado: ${error}`,
    noMicrophone: (error: string) => `Dictado: no se pudo abrir el micrófono: ${error}`,
    boxChanged: "El texto de la caja cambió durante el dictado; lo paro",
    chatChanged: "Cambiaste de chat durante el dictado; lo paro"
} as const;

const MicIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg viewBox="0 0 24 24" height={height} width={width} className={className}>
        <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
    </svg>
);

let phase: Phase = "idle";
const phaseListeners = new Set<() => void>();

function setPhase(next: Phase) {
    phase = next;
    for (const listener of phaseListeners) listener();
}

interface Active {
    channelId: string;
    /** The draft before the dictation; null until it is confirmed (holding Space, at the fifth press). */
    before: string | null;
    /** What the box held after the last write, to tell the user's own changes apart. */
    written: string;
    phrases: string[];
    partial: string;
    capture: Capture | null;
    heard: boolean;
    stopping: boolean;
}

let active: Active | null = null;
/** Writes into the box, one after another; each writes the newest text. */
let writing = Promise.resolve();

const err = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Ends the dictation where it is: the box keeps what was written. */
function end(a: Active, toast?: string) {
    if (active !== a) return;
    active = null;
    a.capture?.stop();
    native().cancel();
    setPhase("idle");
    if (toast) showToast({ text: toast, variant: "critical" });
}

function render(a: Active) {
    writing = writing.then(() => write(a)).catch(reportFailure);
}

async function write(a: Active) {
    if (active !== a || a.before == null) return;
    const { vocabulary, ...style } = settings.store;
    const said = (a.partial ? [...a.phrases, a.partial] : a.phrases).join(" ");
    const text = compose(a.before, restyle(said, style, parseWords(vocabulary)));
    if (text === a.written) return;
    if (SelectedChannelStore.getChannelId() !== a.channelId) return end(a, TEXT.chatChanged);
    if (getDraft(a.channelId) !== a.written) return end(a, TEXT.boxChanged);
    await replaceChatInput(text);
    await waitFor(() => getDraft(a.channelId) === text, DRAFT_SHOWN_MS);
    a.written = getDraft(a.channelId);
}

function onEvent(event: DictationEvent) {
    const a = active;
    if (!a) return;
    switch (event.type) {
        case "partial":
            a.partial = event.text;
            return render(a);
        case "final":
            a.phrases.push(event.text);
            a.partial = "";
            return render(a);
        case "error":
            log.error(`Dictation failed: ${event.error}`);
            return end(a, TEXT.failed(event.error));
        case "done":
            writing = writing.then(() => {
                if (active !== a) return;
                active = null;
                setPhase("idle");
            });
    }
}

/**
 * Opens the microphone and starts the engine. From the button the dictation is confirmed at once; from Space it waits
 * for the fifth press.
 */
async function begin(channelId: string, from: "button" | "space") {
    if (active) return;
    const a: Active = {
        channelId, before: null, phrases: [], partial: "", capture: null, heard: false, stopping: false,
        // Stryker disable next-line StringLiteral: nothing reads it before confirm() sets it.
        written: ""
    };
    active = a;
    setPhase("warming");
    const { model, language, vocabulary, replacements } = settings.store;
    const started = await native().start({ model, language, vocabulary, replacements });
    if (!started.ok) return end(a, TEXT.failed(started.error));
    if (active !== a) return native().cancel();

    let capture: Capture;
    try {
        capture = await startCapture(samples => native().audio(samples), () => {
            a.heard = true;
            if (active === a && a.before != null && !a.stopping) setPhase("listening");
        }, e => end(a, TEXT.noMicrophone(err(e))));
    } catch (e) {
        return end(a, TEXT.noMicrophone(err(e)));
    }
    if (active !== a) return capture.stop();
    a.capture = capture;
    if (a.stopping) capture.stop();
    if (from === "button") confirm(a, 0);
}

/** From here on the dictated text goes into the box, after the draft minus the spaces holding Space typed. */
function confirm(a: Active, typedSpaces: number) {
    const draft = getDraft(a.channelId);
    a.before = withoutTypedSpaces(draft, typedSpaces);
    a.written = draft;
    if (!a.stopping) setPhase(a.heard ? "listening" : "warming");
    render(a);
}

/** Ends the audio of the active dictation; the last phrases still arrive. */
function stopAudio(a: Active) {
    if (a.stopping) return;
    a.stopping = true;
    a.capture?.stop();
    native().stop();
    setPhase("finishing");
}

/** Escape: drops the dictation and puts the box back as it was, unless the user changed it meanwhile. */
function cancel(a: Active) {
    const { before, written, channelId } = a;
    end(a);
    if (before == null || getDraft(channelId) !== written) return;
    writing = writing.then(() => replaceChatInput(before)).catch(reportFailure);
}

let space: SpaceState = IDLE;

function apply(action: SpaceAction, e: KeyboardEvent) {
    switch (action.kind) {
        case "warmup":
            begin(SelectedChannelStore.getChannelId(), "space").catch(reportFailure);
            return;
        case "swallow":
        case "start":
            e.preventDefault();
            e.stopImmediatePropagation();
            if (action.kind === "start" && active) confirm(active, TYPED);
            return;
        case "stop":
            if (active) stopAudio(active);
            return;
        case "abort":
            if (active?.before === null) end(active);
            if (action.spaces) insertTextIntoChatInputBox(" ".repeat(action.spaces));
    }
}

/** The open chat's own box: not the edit box of a sent message, which lives inside the message list. */
const inChatBox = (target: EventTarget | null) =>
    target instanceof HTMLElement && !!target.closest('[data-slate-editor="true"]') && !target.closest('[id^="chat-messages-"]');

function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && active) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel(active);
        return;
    }
    const plainSpace = e.code === "Space" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !e.isComposing;
    if (plainSpace && inChatBox(e.target)) {
        // Started with the button: Space stops it, as tapping does in Claude Code.
        if (active && !space.presses && !e.repeat) {
            e.preventDefault();
            e.stopImmediatePropagation();
            stopAudio(active);
            return;
        }
        if (!settings.store.holdSpace) return;
        const [next, action] = spaceDown(space, e.repeat);
        space = next;
        apply(action, e);
    } else release(e);
}

/** The Space keyup, another key, or the window losing focus: the hold ends, if there is one. */
function release(e: KeyboardEvent | FocusEvent) {
    const [next, action] = spaceUp(space);
    space = next;
    if (e instanceof KeyboardEvent) apply(action, e);
    else if (action.kind === "stop" && active) stopAudio(active);
    else if (action.kind === "abort" && active?.before === null) end(active);
}

/** Keeps a button's phase current; returns how to stop, once the button is off screen. */
function followPhase(set: (phase: Phase) => void) {
    const listener = () => set(phase);
    phaseListeners.add(listener);
    // Stryker disable next-line ArrowFunction: it only stops updating a button no longer on screen, which React ignores.
    return () => void phaseListeners.delete(listener);
}

function usePhase() {
    const [current, setCurrent] = useState(phase);
    // Stryker disable next-line ArrayDeclaration: any list that never changes runs the effect once, as this empty one.
    useEffect(() => followPhase(setCurrent), []);
    return current;
}

const DictationButton: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    const current = usePhase();
    if (!isMainChat) return null;
    const onClick = () => {
        if (!active) begin(channel.id, "button").catch(reportFailure);
        else stopAudio(active);
    };
    return (
        <ChatBarButton tooltip={TEXT.phase[current]} onClick={onClick}>
            <MicIcon className={`dm-dictation-${current}`} />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "Dictation",
    description: "Dicta en la caja de texto con un modelo de voz local, frase a frase: botón del micrófono o Espacio mantenido. Nunca envía.",
    settings,
    style,

    chatBarButton: {
        icon: MicIcon,
        render: DictationButton
    },

    start() {
        native().onEvent(onEvent);
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("keyup", e => {
            if (e.code === "Space") release(e);
        }, true);
        window.addEventListener("blur", release);
    }
});
