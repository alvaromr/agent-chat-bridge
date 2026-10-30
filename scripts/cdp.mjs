// Runs a JS file in Discord's main page over the local DevTools port and prints the JSON result, or reloads the page.
// Usage: node scripts/cdp.mjs <file.js> | --reload. Discord must have been started as docs/debugging.md explains.
import { readFileSync } from "fs";

import { connectToDiscord } from "./devtools.mjs";

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
