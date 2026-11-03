// Tells the events `watch` repeats from new ones, without Discord, so test/ can load it straight from Node.

/** Keys remembered at most; past it the memory starts over, since a repeat follows its first soon after. */
const MAX_KEYS = 200;

/** A check that is true the first time it sees each key, and false on each repeat. */
export function firstTimeChecker() {
    const seen = new Set<string>();
    return (key: string) => {
        if (seen.has(key)) return false;
        if (seen.size >= MAX_KEYS) seen.clear();
        seen.add(key);
        return true;
    };
}
