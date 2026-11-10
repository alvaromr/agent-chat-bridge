// Discord's HTTP cache, where `pnpm check-discord` reads the version the app last loaded (test/discord-code.mjs and
// test/discord-css.mjs). Reads only the entries of the app page and its assets (https://discord.com/app and
// /assets/*.js or *.css), never the cached API answers, which hold private messages.
import { closeSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";

const CACHE = join(homedir(), "Library", "Application Support", "discord", "Cache", "Cache_Data");

// Chromium's simple cache: `<hash>_0` holds a 24-byte header, the key (the URL), the body, an end record, the HTTP
// headers, an optional SHA-256 of the key and a last end record.
const END_MAGIC = 0xf4fa6f45970d41d8n;
const HEADER_BYTES = 24, END_BYTES = 24;

function cacheKey(file) {
    const head = Buffer.alloc(HEADER_BYTES + 300);
    const fd = openSync(join(CACHE, file), "r");
    readSync(fd, head, 0, head.length, 0);
    closeSync(fd);
    return head.subarray(HEADER_BYTES, HEADER_BYTES + Math.min(head.readUInt32LE(12), 300)).toString("latin1");
}

/** An entry's body, decoded, or null when the entry is incomplete. */
export function cacheBody(file) {
    const b = readFileSync(join(CACHE, file));
    const end0 = b.length - END_BYTES;
    const flags = b.readUInt32LE(end0 + 8), headersSize = b.readUInt32LE(end0 + 16);
    const headersStart = end0 - (flags & 2 ? 32 : 0) - headersSize, end1 = headersStart - END_BYTES;
    if (b.readBigUInt64LE(end0) !== END_MAGIC || b.readBigUInt64LE(end1) !== END_MAGIC) return null;
    const body = b.subarray(HEADER_BYTES + b.readUInt32LE(12), end1);
    // Bodies sent with a compression dictionary ("dcb") are stored already decoded.
    const brotli = /content-encoding:\s*br\b/i.test(b.subarray(headersStart, headersStart + headersSize).toString("latin1"));
    return (brotli ? brotliDecompressSync(body) : body).toString();
}

/**
 * The Discord the checks run against: the app's version, and its web client's build and release channel, from the
 * newest cached app page. The web client updates without the app, so both name what was tested.
 */
export function discordVersion() {
    const plist = readFileSync("/Applications/Discord.app/Contents/Info.plist", "utf8");
    const app = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    const { page } = indexCache();
    const html = page ? cacheBody(page.file) ?? "" : "";
    const build = html.match(/"BUILD_NUMBER":"(\d+)"/)?.[1];
    const channel = html.match(/"RELEASE_CHANNEL":"(\w+)"/)?.[1];
    if (!app || !build || !channel) throw new Error("Discord's version isn't readable: open Discord once, from /Applications");
    return { app, build, channel };
}

/** Cached scripts and stylesheets by file name, and the newest cached app page. */
export function indexCache() {
    const scripts = new Map(), styles = new Map();
    let page;
    for (const file of readdirSync(CACHE)) {
        if (!file.endsWith("_0")) continue;
        const key = cacheKey(file);
        const asset = key.match(/^1\/0\/https:\/\/discord\.com\/assets\/([\w.-]+\.(js|css))(?:\?cdt=1)?$/);
        if (asset) (asset[2] === "js" ? scripts : styles).set(asset[1], file);
        const time = key.match(/^1\/0\/https:\/\/discord\.com\/app\?_=(\d+)$/)?.[1];
        if (time && (!page || +time > page.time)) page = { time: +time, file };
    }
    return { scripts, styles, page };
}
