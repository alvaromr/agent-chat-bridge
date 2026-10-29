// Index access for loops whose bounds already keep the index inside the list. No imports, so test/ loads it directly.

/** The element at that index; a RangeError if there is none, since the caller's bounds should rule that out. */
export function elementAt<T>(list: readonly T[], index: number): T {
    const element = list[index];
    if (element === undefined) throw new RangeError(`Index ${index} outside a list of ${list.length}`);
    return element;
}
