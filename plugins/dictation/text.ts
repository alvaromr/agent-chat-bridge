// The chat box's text during a dictation: what was there before it, then the dictated phrases. Pure.

/** The draft without the spaces that holding Space typed before the dictation started, if it ends with them. */
export function withoutTypedSpaces(draft: string, spaces: number): string {
    let end = draft.length;
    while (draft.length - end < spaces && draft[end - 1] === " ") end--;
    return draft.slice(0, end);
}

/** The draft before the dictation, then what was said, one space apart. */
export function compose(before: string, said: string): string {
    if (!before || !said) return before + said;
    return /\s$/.test(before) ? before + said : `${before} ${said}`;
}
