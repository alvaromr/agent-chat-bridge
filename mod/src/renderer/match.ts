// Finds a chat by name, and picks by date the chats and messages `list` and `read` return, without touching Discord,
// so test/ can load it straight from Node.
import type { ComposeCandidate, ComposeRequest } from "../ipc";
import { DEFAULT_READ_LIMIT, MAX_READ_LIMIT } from "../limits.mts";

export interface Candidate extends ComposeCandidate {
    /** Names the query is matched against, strongest first; `weak` ones (group members) count for less. */
    names: string[];
    weak?: string[];
    lastMessageId: string;
    /** Server channels and threads only: the server's id and name. */
    guildId?: string;
    server?: string;
}

const MAX_CANDIDATES = 30;
/** Score of the query starting a word of the name; anything weaker never picks a chat on its own. */
const STRONG_MATCH = 40;

export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

const commonPrefix = (a: string, b: string) => {
    let i = 0;
    // Stryker disable next-line ConditionalExpression,EqualityOperator: the bound only stops two equal strings, and nameScore returns before comparing those.
    while (i < a.length && a[i] === b[i]) i++;
    return i;
};

function nameScore(name: string, q: string) {
    const n = fold(name);
    if (n === q) return 100;
    if (n.startsWith(q)) return 60;
    // Stryker disable next-line Regex: the empty words between repeated separators never start or share a prefix with the query, which is not empty here.
    const words = n.split(/[\s\-_.,·#]+/);
    if (words.some(word => word.startsWith(q))) return STRONG_MATCH;
    if (n.includes(q)) return 20;
    // Short forms of a name ("alex" for "alejandro"): nearly the whole query starts one of its words.
    const fuzzy = Math.max(0, ...words.map(word => commonPrefix(word, q)));
    return fuzzy >= 3 && fuzzy >= q.length - 1 ? 10 : 0;
}

const KIND_BONUS = { dm: 5, grupo: 3, canal: 0, hilo: 0 };

function score(c: Candidate, q: string) {
    const strong = Math.max(0, ...c.names.map(n => nameScore(n, q)));
    const weak = Math.max(0, ...c.weak?.map(n => nameScore(n, q)) ?? []) / 2;
    const best = Math.max(strong, weak);
    return best && best + KIND_BONUS[c.kind];
}

export const byRecency = (a: Candidate, b: Candidate) => Number(BigInt(b.lastMessageId) - BigInt(a.lastMessageId));

/**
 * Picks a chat only on a unique strong match (whole name, or the query starting one of its words). Otherwise returns
 * every chat that matches at all, best first, so the caller looks at all of them instead of trusting a short form.
 */
export function match(all: Candidate[], query: string): { chat?: Candidate; candidates: Candidate[]; } {
    const q = fold(query);
    const ranked = all
        .map(c => ({ c, s: score(c, q) }))
        .filter(r => r.s > 0)
        .sort((a, b) => b.s - a.s || byRecency(a.c, b.c));
    const [first, second] = ranked;
    return first && first.s >= STRONG_MATCH && (!second || first.s > second.s)
        ? { chat: first.c, candidates: [] }
        : { candidates: ranked.slice(0, MAX_CANDIDATES).map(r => r.c) };
}

/** Creation time of a Discord id (snowflake), in ms since epoch. */
export const snowflakeTime = (id: string) => Number((BigInt(id) >> 22n) + 1420070400000n);

export const inRange = (time: number, { since, until }: ComposeRequest) =>
    (since == null || time >= since) && (until == null || time < until);

/** A chat's loaded messages, oldest first, whether older ones exist, and which ones are unread. */
interface LoadedMessages<M> {
    messages: M[];
    hasMoreBefore: boolean;
    isUnread(message: NoInfer<M>): boolean;
}

/** The messages `read` returns, and what it says about the ones it couldn't see. */
export function selectMessages<M extends { timestamp: Date; }>({ messages, hasMoreBefore, isUnread }: LoadedMessages<M>, req: ComposeRequest) {
    const time = (m: M) => new Date(m.timestamp).getTime();
    const [oldest] = messages;
    const limit = req.limit ?? (req.since != null || req.until != null || req.unreadOnly || req.older ? MAX_READ_LIMIT : DEFAULT_READ_LIMIT);
    return {
        selected: messages.filter(m => inRange(time(m), req) && (!req.unreadOnly || isUnread(m))).slice(-limit),
        unreadLoaded: messages.filter(isUnread).length,
        /** False when older messages than the oldest loaded one may still fall in the range. */
        rangeComplete: req.since == null || !hasMoreBefore || (oldest != null && time(oldest) < req.since),
        moreUnreadNotLoaded: hasMoreBefore && oldest != null && isUnread(oldest)
    };
}
