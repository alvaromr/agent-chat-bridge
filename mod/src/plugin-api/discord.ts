// The Discord pieces mod/ and the plugins use, looked up in Discord's webpack modules on first use.
import type { ComponentType, ReactNode } from "react";

import { filters, find, findInModule, lazy } from "../renderer/webpack";
import type * as t from "./discordTypes";

/** Object whose properties are read from the Discord module once it is found. Methods stay bound to it. */
function lazyObject<T extends object>(name: string, get: () => any): T {
    const resolve = lazy(name, get);
    return new Proxy({} as T, {
        get(_, key) {
            const target = resolve();
            const value = target[key];
            // Methods and arrow functions have no prototype; classes and components keep theirs and stay unbound.
            return typeof value === "function" && !Object.hasOwn(value, "prototype") ? value.bind(target) : value;
        }
    });
}

function lazyFunction<T extends (...args: any[]) => any>(name: string, get: () => any): T {
    const resolve = lazy<T>(name, get);
    return ((...args: Parameters<T>) => resolve()(...args)) as T;
}

function lazyComponent<T extends ComponentType<any>>(name: string, get: () => any): T {
    const resolve = lazy<ComponentType<any>>(name, get);
    return (props => React.createElement(resolve(), props)) as T;
}

export const React: typeof import("react") = lazyObject("React", () => find(filters.byProps("createElement", "useEffect")));
export const useState = ((...args: any[]) => (React.useState as any)(...args)) as typeof React.useState;

const store = <N extends keyof t.Stores>(name: N) => lazyObject<t.Stores[N]>(name, () => find(filters.byStoreName(name)));
export const ActiveJoinedThreadsStore = store("ActiveJoinedThreadsStore");
export const ChannelStore = store("ChannelStore");
export const DraftStore = store("DraftStore");
export const GuildMemberStore = store("GuildMemberStore");
export const GuildRoleStore = store("GuildRoleStore");
export const GuildStore = store("GuildStore");
export const PendingReplyStore = store("PendingReplyStore");
export const PermissionStore = store("PermissionStore");
export const ReadStateStore = store("ReadStateStore");
export const RelationshipStore = store("RelationshipStore");
export const MessageStore = store("MessageStore");
export const SelectedChannelStore = store("SelectedChannelStore");
export const UploadAttachmentStore = store("UploadAttachmentStore");
export const UserGuildSettingsStore = store("UserGuildSettingsStore");
export const UserStore = store("UserStore");

export const DraftType: { ChannelMessage: number; } = lazyObject("DraftType", () => find(filters.byProps("ChannelMessage", "SlashCommand")));
// Discord has a second instance, for popout windows, that the chat box doesn't listen to; only the main one has a logger.
// The first instance found is not always the main one, so the lookup checks for the logger.
export const ComponentDispatch: any = lazyObject("ComponentDispatch", () => find(m => m.dispatchToLastSubscribed !== undefined && m.options?.logger != null));
export const MessageActions: any = lazyObject("MessageActions", () => find(filters.byProps("editMessage", "sendMessage")));
/** Discord's message manager; its fetchMessages is what CHANNEL_SELECT runs when the user opens a chat. */
export const MessageManager: { fetchMessages(args: { guildId: string | null; channelId: string; }): void; } =
    lazyObject("MessageManager", () => find(filters.byProps("loadSelectedChannelIfNecessary", "fetchMessages")));
export const DraftActions:{ saveDraft(channelId: string, text: string, draftType: number): void; } =
    lazyObject("DraftActions", () => find(filters.byProps("clearDraft", "saveDraft")));
export const ChannelRouter = {
    transitionToChannel: lazyFunction<(channelId: string) => void>("transitionToChannel", () => findInModule('"Thread must have a parent ID."', filters.byCode(".openTextInVoiceIfVoiceChannel")))
};

/** Discord's add-reaction action, the one its reaction picker calls (found by strings only it contains). */
export const addReaction = lazyFunction<(channelId: string, messageId: string, emoji: { id: string | null; name: string; animated: boolean; }) => Promise<void>>(
    "addReaction", () => find(filters.byCode('"Message Shortcut"', "MESSAGE_SHORTCUT_ACTION_SENT", '"MESSAGE_REACTION_ADD"')));
/** Discord's remove-reaction action, the one clicking one's own reaction calls (the only one using that endpoint flag). */
export const removeReaction = lazyFunction<(args: { channelId: string; messageId: string; emoji: { id: string | null; name: string; animated: boolean; }; }) => Promise<void>>(
    "removeReaction", () => find(filters.byCode('"MESSAGE_REACTION_REMOVE"', "useTypeEndpoint:!0")));
export const FluxDispatcher: t.FluxDispatcher = lazyObject("FluxDispatcher", () => find(filters.byProps("dispatch", "subscribe", "_actionHandlers")));
export const UploadHandler = {
    promptToUpload: lazyFunction<(files: File[], channel: t.Channel, draftType: number) => void>("promptToUpload",
        () => find(filters.byCode("Unexpected mismatch between files and file metadata")))
};

export const showToast = lazyFunction<(toast: t.ToastData) => void>("showToast", () => find(filters.byCode(".currentToastMap.has(")));
export const openModal = lazyFunction<(render: (props: t.RenderModalProps) => ReactNode) => string>("openModal",
    () => findInModule(".modalKey?", filters.byCode(",instant:")));

export const Modal = lazyComponent<t.ModalComponent>("Modal", () => find(filters.byCode("leadingLayout:", "actions:", ".message")));
export const TextArea = lazyComponent<t.TextAreaComponent>("TextArea", () => find(filters.componentByCode("!0,rows:", "showRemainingCharacterCount:")));
export const Tooltip = lazyComponent<t.TooltipComponent>("Tooltip", () => find(m => m.prototype?.shouldShowTooltip && m.prototype.render));
export const Clickable = lazyComponent<t.ClickableComponent>("Clickable", () => find(filters.componentByCode("this.context?this.renderNonInteractive():")));
