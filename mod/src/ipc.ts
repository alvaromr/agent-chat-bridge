// IPC channel names shared by the main process and the preload.
export const IPC = {
    getRenderer: "discord-mod:get-renderer",
    getSettings: "discord-mod:get-settings",
    setSettings: "discord-mod:set-settings",
    runClaude: "discord-mod:run-claude",
    composeRequest: "discord-mod:compose-request",
    composeResponse: "discord-mod:compose-response",
    /** main → renderer: the chats some `watch` is listening to. Renderer → main (sync): ask for them. */
    watchSet: "discord-mod:watch-set",
    watchGet: "discord-mod:watch-get",
    /** renderer → main: a new, edited or deleted message in a watched chat. */
    watchEvent: "discord-mod:watch-event"
} as const;

/**
 * What scripts/discord-mod.mjs asks for: one of a draft (the default), `list`, `unread`, `read`, `send`, `edit`,
 * `delete` or `react`. Only the last four publish anything, and the CLI documents that they need the user's
 * confirmation (rule 3).
 */
export interface ComposeRequest {
    list?: boolean;
    kinds?: ComposeCandidate["kind"][];
    /** With `list` or `unread`: only server channels and threads of servers whose name contains this. */
    server?: string;
    /** Chats with unread messages (no content). */
    unread?: boolean;
    /** Last messages of this chat, among the ones Discord has loaded. */
    read?: string;
    limit?: number;
    /** With `read`: only unread messages. */
    unreadOnly?: boolean;
    /** With `read`: like scrolling up, load up to 3 older pages until the first unread message. */
    more?: boolean;
    /** With `read`, instead of `more`: like scrolling up, load this many older pages (1 to 3), read or not. */
    older?: number;
    /** With a draft: reply to this message of the chat, as Discord's Reply button does. */
    replyTo?: string;
    /** With a draft: absolute paths of files to attach (scripts/discord-mod.mjs → main process). */
    attach?: string[];
    /** Set by the main process from `attach`: the files' contents for the renderer. */
    files?: { name: string; type: string; data: Uint8Array; }[];
    /** Send what this chat's box holds, only if its text is exactly `expect` (what the user confirmed). */
    send?: string;
    expect?: string;
    /** With `send`: send `expect` itself (plus `replyTo`) without opening the chat or using its box. */
    direct?: boolean;
    /** Change the text of one of the user's own loaded messages. */
    edit?: { chatId: string; messageId: string; text: string; };
    /** Delete one of the user's own loaded messages, for everyone. */
    delete?: { chatId: string; messageId: string; };
    /** Add the user's reaction (a Unicode emoji) to a loaded message, or with `remove` take it away. */
    react?: { chatId: string; messageId: string; emoji: string; remove?: boolean; };
    /** With a draft (no text, attachments or reply): empty the chat's box without opening the chat. */
    clear?: boolean;
    /** Keep the connection open and stream a ComposeEvent per change in these chats (handled by main). */
    watch?: string[];
    /** With `read`, if the chat isn't loaded: load it as opening it would, without opening it or marking it read. */
    fetch?: boolean;
    /** Local time range in ms since epoch, `until` exclusive: messages for `read`, last activity for `list`/`unread`. */
    since?: number;
    until?: number;
    query?: string;
    channelId?: string;
    text?: string;
    /** Overwrite an existing draft in that chat. */
    replace?: boolean;
    /** Only report which chat would be used; touch nothing. */
    dryRun?: boolean;
    /** With a draft: don't bring Discord to the front (it still opens the chat inside Discord). */
    background?: boolean;
}

export interface ComposeCandidate {
    id: string;
    kind: "dm" | "grupo" | "canal" | "hilo";
    label: string;
}

export interface ComposeMessage {
    id: string; autor: string; yo: boolean; fecha: string; texto: string; sinLeer: boolean; meMencionan: boolean;
    /** When the message was last edited. */
    editado?: string;
    /** The message it replies to; author and excerpt only if Discord has that message. */
    respondeA?: { id: string; autor?: string; extracto?: string; };
    adjuntos: { nombre: string; tipo?: string; url: string; }[];
    embeds?: { autor?: string; titulo?: string; descripcion?: string; campos: string[]; }[];
    reacciones?: { emoji: string; total: number; mia: boolean; }[];
}

/** What `watch` streams, one JSON line per new, edited or deleted message in a watched chat. */
export type ComposeEvent =
    | { evento: "mensaje" | "editado"; chat: ComposeCandidate; mensaje: ComposeMessage; }
    | { evento: "borrado"; chat: ComposeCandidate; id: string; };

export type ComposeResult =
    | { ok: true; chat: ComposeCandidate; abierto: boolean; borradorCargado: boolean; respondiendo?: boolean; adjuntos?: number; }
    | { ok: true; chats: ComposeCandidate[]; }
    | { ok: true; chat: ComposeCandidate; enviado: true; id: string; }
    | { ok: true; chat: ComposeCandidate; reaccionado: true; }
    | { ok: true; chat: ComposeCandidate; reaccionQuitada: true; }
    | { ok: true; chat: ComposeCandidate; vaciado: true; }
    | { ok: true; chat: ComposeCandidate; editado: true; }
    | { ok: true; chat: ComposeCandidate; borrado: true; }
    | { ok: true; sinLeer: (ComposeCandidate & { mensajes: number; menciones: number; silenciado: boolean; })[]; }
    | {
        ok: true;
        chat: ComposeCandidate;
        mensajes: ComposeMessage[];
        /** Messages Discord has loaded for the chat, and how many of them are unread (before --limit and filters). */
        cargados: number;
        sinLeerCargados: number;
        /** Older pages loaded by --more or --older. */
        paginasExtra: number;
        /** Older messages exist than the oldest loaded one. */
        hayMasAntiguos: boolean;
        /** False when the range may reach back past the oldest message Discord has loaded. */
        rangoCompleto: boolean;
        /** True when the oldest loaded message is already unread and older ones exist: more unread than shown. */
        masSinLeerSinCargar: boolean;
    }
    | { ok: false; error: string; candidatos?: ComposeCandidate[]; revisados?: Record<ComposeCandidate["kind"], number>; };
