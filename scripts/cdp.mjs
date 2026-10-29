// Runs a JS file in Discord's main page over the local DevTools port and prints the JSON result, or reloads the page.
// Usage: node scripts/cdp.mjs <file.js> | --reload. Discord must have been started as docs/debugging.md explains.
import { readFileSync } from "fs";

const [arg] = process.argv.slice(2);
if (!arg) {
    console.error("Usage: node scripts/cdp.mjs <file.js> | --reload");
    process.exit(2);
}

const targets = await (await fetch("http://127.0.0.1:9229/json")).json();
const page = targets.find(t => t.type === "page" && t.url.startsWith("https://discord.com/"));
if (!page) throw new Error("Discord's page is not among the DevTools targets");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});

const reload = arg === "--reload";
ws.send(JSON.stringify(reload
    ? { id: 1, method: "Page.reload", params: {} }
    : { id: 1, method: "Runtime.evaluate", params: { expression: readFileSync(arg, "utf8"), awaitPromise: true, returnByValue: true } }
));
ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id !== 1) return;
    console.log(reload ? "reloaded" : JSON.stringify(msg.result.exceptionDetails ?? msg.result.result.value, null, 2));
    ws.close();
};
