// Types of the Discord objects, stores and components that mod/ and the plugins touch: only the members they use, with
// absence (`undefined`, `null`) where Discord can return it.
// Derived from Vencord (https://github.com/Vendicated/Vencord), Copyright (c) Vendicated and contributors; modified
// since 2026-10-29. GPL-3.0-or-later (LICENSE).
import type { ComponentType, ReactNode } from "react";

export interface User {
    id: string;
    username: string;
    /** Null when the user set no display name. */
    globalName?: string | null | undefined;
}

interface Attachment {
    filename: string;
    url: string;
    content_type?: string;
}

export interface Message {
    id: string;
    channel_id: string;
    content: string;
    author: User;
    attachments: Attachment[];
    timestamp: Date;
    editedTimestamp: Date | null;
    messageReference?: { message_id: string; channel_id: string; guild_id?: string; };
    embeds: unknown[];
    reactions: unknown[];
    mentions: string[];
    mentionRoles: string[];
    mentionEveryone: boolean;
    state: string;
}

/** A chat's loaded messages, oldest first. */
interface ChannelMessages {
    _array: Message[];
    ready: boolean;
    /** Filled from Discord's local cache, not yet from the network. */
    cached: boolean;
    loadingMore: boolean;
    hasMoreBefore: boolean;
}

export interface Channel {
    id: string;
    type: number;
    name: string;
    guild_id: string | null;
    parent_id: string | null;
    lastMessageId: string | null | undefined;
    recipients: string[];
    isDM(): boolean;
    isGroupDM(): boolean;
    getRecipientId(): string | undefined;
}

interface Guild {
    id: string;
    name: string;
}

export interface FluxDispatcher {
    dispatch(action: { type: string; [key: string]: unknown; }): Promise<void>;
    subscribe(event: string, handler: (action: any) => void): void;
}

export interface Stores {
    ActiveJoinedThreadsStore: { getActiveJoinedThreadsForGuild(guildId: string): Record<string, Record<string, { channel: Channel; }>>; };
    ChannelStore: {
        getChannel(id: string): Channel | undefined;
        getChannelIds(guildId?: string | null): string[];
        getSortedPrivateChannels(): Channel[];
    };
    DraftStore: { getDraft(channelId: string, draftType: number): string; };
    GuildMemberStore: { getMember(guildId: string, userId: string): { roles: string[]; nick?: string | null; } | null; };
    GuildRoleStore: { getRole(guildId: string, roleId: string): { name: string; } | undefined; };
    GuildStore: { getGuild(id: string): Guild | undefined; getGuilds(): Record<string, Guild>; };
    PendingReplyStore: { getPendingReply(channelId: string): { message: Message; } | undefined; };
    PermissionStore: { can(permission: bigint, channel: Channel): boolean; };
    ReadStateStore: {
        ackMessageId(channelId: string): string | null;
        getMentionCount(channelId: string): number;
        getUnreadCount(channelId: string): number;
        hasUnread(channelId: string): boolean;
    };
    RelationshipStore: { getNickname(userId: string): string | undefined; };
    MessageStore: {
        getMessage(channelId: string, messageId: string): Message | undefined;
        getMessages(channelId: string): ChannelMessages;
    };
    SelectedChannelStore: { getChannelId(): string; };
    UploadAttachmentStore: { getUploadCount(channelId: string, draftType: number): number; };
    UserGuildSettingsStore: {
        isChannelMuted(guildId: string | null, channelId: string): boolean;
        isGuildOrCategoryOrChannelMuted(guildId: string, channelId: string): boolean;
    };
    UserStore: { getCurrentUser(): User; getUser(id: string): User | undefined; };
}

export interface ToastData {
    text: string;
    variant?: "info" | "success" | "critical";
}

/** What Discord passes to the content of a modal it opens. */
export interface RenderModalProps {
    transitionState: number;
    onClose(): void;
}

export type ModalComponent = ComponentType<RenderModalProps & {
    size?: "sm" | "md" | "lg";
    title: string;
    subtitle?: string;
    actions?: { text: string; variant: "primary" | "secondary"; onClick(): void; }[];
    children?: ReactNode;
}>;
export type TextAreaComponent = ComponentType<{ value: string; onChange(value: string): void; rows?: number; autosize?: boolean; }>;
export type TooltipComponent = ComponentType<{ text: ReactNode; children(props: Record<string, any>): ReactNode; }>;
export type ClickableComponent = ComponentType<Record<string, any> & { children?: ReactNode; }>;
