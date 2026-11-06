// Runs a JS file in Discord's main page over the local DevTools port and prints the JSON result, or reloads the page.
// Usage: node scripts/cdp.mjs <file.js> | --reload. Discord must have been started as docs/debugging.md explains.
import { readFileSync } from "fs";

/** Connects to Discord's main page; `send` runs a DevTools command and resolves with its result. */
async function connectToDiscord() {
    const targets = await (await fetch("http://127.0.0.1:9229/json")).json();
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

const [arg] = process.argv.slice(2);
if (!arg) {
    console.error("Usage: node scripts/cdp.mjs <file.js> | --reload");
    process.exit(2);
}

const discord = await connectToDiscord();
if (arg === "--reload") {
    await discord.send("Page.reload");
    console.log("reloaded");
} else {
    const { result, exceptionDetails } = await discord.send("Runtime.evaluate", {
        expression: readFileSync(arg, "utf8"), awaitPromise: true, returnByValue: true
    });
    console.log(JSON.stringify(exceptionDetails ?? result.value, null, 2));
}
discord.close();
