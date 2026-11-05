// A fake of mod/src/plugin-api/discord.ts, the one module through which mod/ and the plugins reach Discord: its React
// is the real one, of the version Discord ships; its stores read `state`, which each test fills; its actions are mocks
// that change `state` as Discord would once the server accepts them; its components render plain elements with the
// props they get. What Discord itself does with them (its focus rings, its modal's Escape, its colours, the stores'
// real shapes) is checked by `pnpm live`.
import * as ReactModule from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

// React's test mode: act() applies every render and effect before it returns.
/** @type {any} */ (globalThis).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A mock with its own implementation, typed loosely: the tests read its calls and replace its behaviour.
 * @param {any} [impl] @returns {any}
 */
const mock = impl => vi.fn(impl);

export const React = ReactModule;
export const { useState, useEffect } = ReactModule;

/** Empty, as each test starts; every collection is keyed by id. */
const blank = () => ({
    me: { id: "me", username: "yo", globalName: "Yo" },
    users: new Map(),
    nicknames: new Map(),
    channels: new Map(),
    privateChannels: /** @type {any[]} */ ([]),
    guilds: new Map(),
    /** Guild id → its channels' ids, in Discord's order. */
    guildChannels: new Map(),
    /** Guild id → its joined threads, as ActiveJoinedThreadsStore groups them (by parent, then by id). */
    threads: new Map(),
    /** Channel ids the user can't see. */
    hidden: new Set(),
    /** Chat id → { ack, unread, mentions }. */
    readStates: new Map(),
    muted: new Set(),
    /** Chat id → its loaded messages, as MessageStore keeps them. */
    chats: new Map(),
    /** Chat id → the older pages MessageActions.fetchMessages loads, newest first: { messages, more }. */
    older: new Map(),
    drafts: new Map(),
    uploads: new Map(),
    pendingReplies: new Map(),
    roles: new Map(),
    members: new Map(),
    selected: "1"
});
export const state = blank();

/** A chat's loaded messages, from the network unless said otherwise. */
export function loaded(channelId, messages, more = {}) {
    state.chats.set(channelId, { _array: messages, ready: true, cached: false, loadingMore: false, hasMoreBefore: false, ...more });
    return state.chats.get(channelId);
}

/** A channel with Discord's methods. */
export function channel(fields) {
    return {
        type: 0, name: "", guild_id: null, parent_id: null, lastMessageId: "0", recipients: [], ...fields,
        isDM() { return this.type === 1; },
        isGroupDM() { return this.type === 3; },
        getRecipientId() { return this.recipients[0]; }
    };
}

const messageOf = (channelId, id) => state.chats.get(channelId)?._array.find(m => m.id === id);

export const UserStore = { getCurrentUser: () => state.me, getUser: id => state.users.get(id) };
export const RelationshipStore = { getNickname: id => state.nicknames.get(id) };
export const ChannelStore = {
    getChannel: id => state.channels.get(id),
    getChannelIds: guildId => state.guildChannels.get(guildId) ?? [],
    getSortedPrivateChannels: () => state.privateChannels
};
export const GuildStore = { getGuild: id => state.guilds.get(id), getGuilds: () => Object.fromEntries(state.guilds) };
export const ActiveJoinedThreadsStore = { getActiveJoinedThreadsForGuild: guildId => state.threads.get(guildId) ?? {} };
export const PermissionStore = { can: (_permission, ch) => !state.hidden.has(ch.id) };
export const ReadStateStore = {
    ackMessageId: id => state.readStates.get(id)?.ack ?? null,
    getUnreadCount: id => state.readStates.get(id)?.unread ?? 0,
    getMentionCount: id => state.readStates.get(id)?.mentions ?? 0,
    hasUnread: id => (state.readStates.get(id)?.unread ?? 0) > 0
};
export const UserGuildSettingsStore = {
    isChannelMuted: (_guildId, id) => state.muted.has(id),
    isGuildOrCategoryOrChannelMuted: (guildId, id) => state.muted.has(guildId) || state.muted.has(id)
};
export const MessageStore = {
    getMessage: messageOf,
    getMessages: id => state.chats.get(id) ?? { _array: [], ready: false, cached: false, loadingMore: false, hasMoreBefore: false }
};
export const GuildMemberStore = { getMember: (guildId, userId) => state.members.get(`${guildId}/${userId}`) ?? null };
export const GuildRoleStore = { getRole: (guildId, id) => state.roles.get(`${guildId}/${id}`) };
export const DraftType = { ChannelMessage: 0 };
export const DraftStore = { getDraft: (channelId, type) => type === DraftType.ChannelMessage ? state.drafts.get(channelId) ?? "" : "" };
export const SelectedChannelStore = { getChannelId: () => state.selected };
export const UploadAttachmentStore = { getUploadCount: (channelId, type) => type === DraftType.ChannelMessage ? state.uploads.get(channelId) ?? 0 : 0 };
export const PendingReplyStore = { getPendingReply: id => state.pendingReplies.get(id) };

export const MessageActions = {
    editMessage: mock(async (channelId, id, { content }) => {
        const message = messageOf(channelId, id);
        if (message) message.content = content;
    }),
    deleteMessage: mock(async (channelId, id) => {
        const chat = state.chats.get(channelId);
        if (chat) chat._array = chat._array.filter(m => m.id !== id);
    }),
    sendMessage: mock(async () => ({ body: { id: "sent" } })),
    getSendMessageOptionsForReply: mock(({ message }) => ({ messageReference: { message_id: message.id } })),
    /**
     * An older page: what the test put in `state.older` for that chat goes before its messages, at once, or `arrives`
     * ms later with `loadingMore` on until `done` ms, as Discord loads it from the network.
     */
    fetchMessages: mock(({ channelId }) => {
        const chat = state.chats.get(channelId);
        const page = state.older.get(channelId)?.shift();
        if (!chat || !page) return;
        const add = () => {
            chat._array = [...page.messages, ...chat._array];
            chat.hasMoreBefore = page.more;
        };
        if (!page.arrives) return add();
        chat.loadingMore = true;
        setTimeout(add, page.arrives);
        setTimeout(() => void (chat.loadingMore = false), page.done ?? page.arrives);
    })
};
export const MessageManager = {
    fetchMessages: mock(({ channelId }) => {
        const chat = state.chats.get(channelId);
        if (chat) Object.assign(chat, { ready: true, cached: false });
    })
};
export const DraftActions = { saveDraft: mock((channelId, text) => void state.drafts.set(channelId, text)) };
export const ChannelRouter = { transitionToChannel: mock(id => void (state.selected = id)) };
/** The user's own Unicode reaction, as Discord stores it. */
const reactions = (channelId, messageId) => messageOf(channelId, messageId)?.reactions;
export const addReaction = mock(async (channelId, messageId, emoji) => {
    reactions(channelId, messageId)?.push({ emoji: { id: null, name: emoji.name }, count: 1, me: true });
});
export const removeReaction = mock(async ({ channelId, messageId, emoji }) => {
    const list = reactions(channelId, messageId);
    if (list) list.splice(list.findIndex(r => r.emoji.name === emoji.name && (r.emoji.id ?? null) === emoji.id && r.me), 1);
});
export const UploadHandler = {
    promptToUpload: mock((files, ch) => void state.uploads.set(ch.id, (state.uploads.get(ch.id) ?? 0) + files.length))
};

/** Discord's event bus: `dispatch` runs every handler subscribed to the action's type. */
const handlers = new Map();
export const FluxDispatcher = {
    subscribe: mock((type, handler) => void handlers.set(type, [...handlers.get(type) ?? [], handler])),
    dispatch: mock(async action => {
        for (const handler of handlers.get(action.type) ?? []) handler(action);
    })
};
/**
 * The open chat's box, as Discord renders it: its Slate editor inside the chat's text area, showing the draft. Returns
 * the editor.
 */
export function chatBox(draft = "") {
    const area = document.body.appendChild(Object.assign(document.createElement("div"), { className: "channelTextArea_a1b2" }));
    const editor = area.appendChild(Object.assign(document.createElement("div"), { role: "textbox", textContent: draft }));
    editor.setAttribute("data-slate-editor", "true");
    editor.tabIndex = 0;
    state.drafts.set(state.selected, draft);
    return editor;
}
const editor = () => document.querySelector('[class*="channelTextArea"] [data-slate-editor="true"]');

/**
 * The open chat's box: INSERT_TEXT replaces the draft when the editor's text is selected and adds to its end
 * otherwise, as the cursor sits there after Discord writes into it.
 */
export const ComponentDispatch = {
    dispatchToLastSubscribed: mock((event, args) => {
        if (event !== "INSERT_TEXT") return;
        const selected = (document.getSelection()?.toString() ?? "") !== "";
        const text = selected ? args.rawText : (state.drafts.get(state.selected) ?? "") + args.rawText;
        state.drafts.set(state.selected, text);
        const box = editor();
        if (box) box.textContent = text;
        document.getSelection()?.removeAllRanges();
    })
};

export const showToast = mock();

/** The roots of the modals open, each in its own element of the body. */
const modals = new Set();
export const openModal = mock(render => {
    const element = document.body.appendChild(document.createElement("div"));
    const root = createRoot(element);
    const close = () => {
        modals.delete(close);
        act(() => root.unmount());
        element.remove();
    };
    modals.add(close);
    act(() => root.render(render({ transitionState: 1, onClose: close })));
    return "modal";
});

export const Modal = ({ title, subtitle, actions = [], children }) => React.createElement("div", { role: "dialog", "aria-label": title },
    React.createElement("h1", null, title),
    subtitle && React.createElement("p", null, subtitle),
    children,
    actions.map(a => React.createElement("button", { key: a.text, type: "button", "data-variant": a.variant, onClick: a.onClick }, a.text)));
export const TextArea = ({ value, onChange, rows }) =>
    React.createElement("textarea", { value, rows, onChange: (/** @type {any} */ e) => onChange(e.currentTarget.value) });
export const Tooltip = ({ text, children }) => React.createElement("span", { "data-tooltip": text }, children({ onMouseEnter: () => { }, onMouseLeave: () => { } }));
export const Clickable = ({ children, ...props }) => React.createElement("div", { role: "button", tabIndex: 0, ...props }, children);

/** Back to an empty Discord: no state, mocks with their own implementations, no modal open. */
export function reset() {
    Object.assign(state, blank());
    handlers.clear();
    for (const close of [...modals]) close();
    document.querySelectorAll('[class*="channelTextArea"]').forEach(area => area.remove());
    for (const fn of [
        MessageActions.editMessage, MessageActions.deleteMessage, MessageActions.sendMessage, MessageActions.getSendMessageOptionsForReply,
        MessageActions.fetchMessages, MessageManager.fetchMessages, DraftActions.saveDraft, ChannelRouter.transitionToChannel, addReaction,
        removeReaction, UploadHandler.promptToUpload, FluxDispatcher.subscribe, FluxDispatcher.dispatch, ComponentDispatch.dispatchToLastSubscribed,
        showToast, openModal
    ]) fn.mockReset();
}
