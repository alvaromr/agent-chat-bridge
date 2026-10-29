// Finds a chat by name and filters by date, without touching Discord, so test/ can load it straight from Node.
import type { ComposeCandidate, ComposeRequest } from "../ipc";

export interface Candidate extends ComposeCandidate {
    /** Names the query is matched against, strongest first; `weak` ones (group members) count for less. */
    names: string[];
    weak?: string[];
    lastMessageId: string;
    /** Server channels and threads only. */
    guildId?: string;
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
    if (words.some(word => word.startsWith(q))) return 40;
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
