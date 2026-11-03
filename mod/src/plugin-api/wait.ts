// Waiting for Discord's stores to show the result of an action, which most actions don't report. No imports, so
// test/ loads it straight from Node.

/**
 * How long Discord's server gets to confirm an action (a loaded page, a sent, edited or deleted message) before it
 * counts as unconfirmed. Under the 10 s the CLI's socket waits (mod/src/compose.ts), so the CLI hears what happened.
 */
export const CONFIRM_MS = 8000;

/** Resolves once the condition holds or the timeout passes, whichever comes first. */
export async function waitFor(condition: () => boolean, timeoutMs: number) {
    for (const end = Date.now() + timeoutMs; !condition() && Date.now() < end;)
        await new Promise(r => setTimeout(r, 50));
}
