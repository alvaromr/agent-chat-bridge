// Client for Discord's main page over the local DevTools port, shared by scripts/cdp.mjs and test/live/a11y.mjs.
// Discord must have been started with the port, as docs/debugging.md explains.

/** The port's list of pages; it answers only while Discord runs with the port open. */
export const DEVTOOLS_TARGETS = "http://127.0.0.1:9229/json";

/** Connects to Discord's main page; `send` runs a DevTools command and resolves with its result. */
export async function connectToDiscord() {
    const targets = await (await fetch(DEVTOOLS_TARGETS)).json();
    const page = targets.find(t => t.type === "page" && t.url.startsWith("https://discord.com/") && !t.url.startsWith("https://discord.com/popout"));
    if (!page) throw new Error("Discord's page is not among the DevTools targets");

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });
    let lastId = 0;
    /** @type {Map<number, (msg: any) => void>} */
    const waiting = new Map();
    ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        waiting.get(msg.id)?.(msg);
        waiting.delete(msg.id);
    };
    /** @param {string} method @param {object} [params] @returns {Promise<any>} */
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++lastId;
        waiting.set(id, msg => msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result));
        ws.send(JSON.stringify({ id, method, params }));
    });
    return { send, close: () => ws.close() };
}
