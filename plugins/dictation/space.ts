// Holding Space in the chat box to dictate, as Claude Code does in its prompt: the first spaces are typed as usual,
// the key's auto-repeat then shows that it is held, and the dictation starts at the fifth press and ends on release.
// Pure: it sees only the key events it is given.

/** Presses typed as usual; at the last of them the microphone opens, since it takes ~0.8 s to give sound. */
export const TYPED = 2;
/** The press that starts the dictation (Claude Code's own count). */
const START_AT = 5;

export type SpaceState = { presses: number; dictating: boolean; };

export const IDLE: SpaceState = { presses: 0, dictating: false };

export type SpaceAction =
    /** Let the key type its space. */
    | { kind: "type"; }
    /** Type it, and open the microphone. */
    | { kind: "warmup"; }
    /** Keep the space out of the box. */
    | { kind: "swallow"; }
    /** Start dictating, with the TYPED spaces out of the box. */
    | { kind: "start"; }
    /** Released while dictating. */
    | { kind: "stop"; }
    /** Released before the start: close the microphone and type the spaces that were kept out. */
    | { kind: "abort"; spaces: number; }
    | { kind: "none"; };

/** A Space keydown in the chat box. `repeat` is the browser's flag for the key's auto-repeat. */
export function spaceDown(state: SpaceState, repeat: boolean): [SpaceState, SpaceAction] {
    if (state.dictating) return [state, { kind: "swallow" }];
    // A press that isn't a repeat, or a repeat whose first press went elsewhere, starts the count again.
    const presses = repeat && state.presses ? state.presses + 1 : 1;
    if (presses < TYPED) return [{ presses, dictating: false }, { kind: "type" }];
    if (presses === TYPED) return [{ presses, dictating: false }, { kind: "warmup" }];
    if (presses < START_AT) return [{ presses, dictating: false }, { kind: "swallow" }];
    return [{ presses, dictating: true }, { kind: "start" }];
}

/** The Space keyup, or any other key while Space is held, which ends the hold the same way. */
export function spaceUp(state: SpaceState): [SpaceState, SpaceAction] {
    if (state.dictating) return [IDLE, { kind: "stop" }];
    if (state.presses >= TYPED) return [IDLE, { kind: "abort", spaces: state.presses - TYPED }];
    return [IDLE, { kind: "none" }];
}
