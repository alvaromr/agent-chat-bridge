// The chats the CLI can name: DMs, groups, visible text channels and joined threads, found by id or by name, and the
// `list` and `unread` answers.
import type { ComposeCandidate, ComposeRequest } from "../ipc";
import { APP_NAME } from "../name.mts";
import {
    ActiveJoinedThreadsStore, ChannelStore, GuildStore, PermissionStore, ReadStateStore, RelationshipStore, UserGuildSettingsStore, UserStore
} from "../plugin-api/discord";
import { byRecency, type Candidate, fold, inRange, match, snowflakeTime } from "./match";

/** Why a request couldn't be done, as the CLI shows it to the user. */
export const TEXT = {
    noChat: "No encuentro ese chat"
} as const;

const TEXT_CHANNEL_TYPES = new Set([0, 5]); // text and announcement
const VIEW_CHANNEL = 1n << 10n;

export const userName = (id: string | undefined) => {
    const user = id && UserStore.getUser(id);
    return user ? [RelationshipStore.getNickname(id), user.globalName, user.username].filter((n): n is string => !!n) : [];
};

export function allCandidates(): Candidate[] {
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

export const pick = ({ id, kind, label }: Candidate): ComposeCandidate => ({ id, kind, label });

/** The chat by id or by name (see `match`), and how many chats of each kind were searched. */
export function resolve(req: ComposeRequest): { chat?: Candidate; candidates: Candidate[]; searched: Record<Candidate["kind"], number>; } {
    const all = allCandidates();
    const searched = { dm: 0, grupo: 0, canal: 0, hilo: 0 };
    for (const c of all) searched[c.kind]++;
    if (req.channelId) {
        const chat = all.find(c => c.id === req.channelId);
        return chat ? { chat, candidates: [], searched } : { candidates: [], searched };
    }
    if (req.query === undefined) throw new Error(`[${APP_NAME}] A draft names its chat by id or by name; validate.ts checks it`);
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
export function listChats(req: ComposeRequest): ComposeCandidate[] {
    return allCandidates()
        .filter(c => wanted(c, req))
        .sort(byRecency)
        .map(pick);
}

/** Every chat with unread messages active in the range, muted ones included and flagged. */
export function unreadChats(req: ComposeRequest) {
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
