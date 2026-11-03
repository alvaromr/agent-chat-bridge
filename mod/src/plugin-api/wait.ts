// Waiting for Discord's stores to show the result of an action, which most actions don't report. No imports, so
// test/ loads it straight from Node.

/** Resolves once the condition holds or the timeout passes, whichever comes first. */
export async function waitFor(condition: () => boolean, timeoutMs: number) {
    for (const end = Date.now() + timeoutMs; !condition() && Date.now() < end;)
        await new Promise(r => setTimeout(r, 50));
}
