// Checks the patches and lookups of mod/ against the Discord code in its HTTP cache, the version the app last loaded.
// Run with `pnpm check-discord`; Discord doesn't need to be open. Discord's code is only parsed, never run.
// Reads only the cache entries of the app page and its scripts (https://discord.com/app and /assets/*.js), never the
// cached API answers, and prints only the names of the patches and lookups.
import assert from "node:assert/strict";
import { closeSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";

import { canonicalize } from "../mod/src/renderer/regex.ts";

const ts = createRequire(import.meta.url)("typescript");
const CACHE = join(homedir(), "Library", "Application Support", "discord", "Cache", "Cache_Data");
const SOURCES = [new URL("../mod/src/", import.meta.url), new URL("../plugins/", import.meta.url)];

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

function cacheBody(file) {
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

/** Cached scripts by file name, and the newest cached app page. */
function indexCache() {
    const scripts = new Map();
    let page;
    for (const file of readdirSync(CACHE)) {
        if (!file.endsWith("_0")) continue;
        const key = cacheKey(file);
        const script = key.match(/^1\/0\/https:\/\/discord\.com\/assets\/([\w.-]+\.js)(?:\?cdt=1)?$/)?.[1];
        if (script) scripts.set(script, file);
        const time = key.match(/^1\/0\/https:\/\/discord\.com\/app\?_=(\d+)$/)?.[1];
        if (time && (!page || +time > page.time)) page = { time: +time, file };
    }
    return { scripts, page };
}

/** File names of the page's scripts and of every chunk its webpack runtime can load (`__webpack_require__.u`). */
function currentFiles(page, readScript) {
    const files = [...page.matchAll(/<script[^>]*src="\/assets\/([\w.-]+\.js)"/g)].map(m => m[1]);
    // Other webpack instances (libdiscore's) have their own runtime; the main one names its chunks with a map.
    for (const file of [...files]) {
        const code = readScript(file);
        const start = code?.search(/\.u=\w+=>/) ?? -1;
        const mapStart = start < 0 ? -1 : code.indexOf('""+({', start);
        if (mapStart < 0) continue;
        const map = code.slice(start, code.indexOf("})[", mapStart));
        for (const m of map.matchAll(/"(\d+)"===\w\?""\+\w\+"\.([0-9a-f]+)\.js"/g)) files.push(`${m[1]}.${m[2]}.js`);
        for (const m of code.slice(mapStart, map.length + start).matchAll(/\d+:"([0-9a-f]+)"/g)) files.push(`${m[1]}.js`);
    }
    return [...new Set(files)];
}

/** Every webpack module factory's source by module id: `123:function(…){…}`, `123:(…)=>…` or `123(…){…}`. */
function modulesOf(code, modules) {
    const sf = ts.createSourceFile("chunk.js", code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    const visit = node => {
        const factory = (ts.isPropertyAssignment(node) && (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer)))
            || ts.isMethodDeclaration(node);
        if (factory && ts.isNumericLiteral(node.name)) {
            if (!modules.has(node.name.text)) modules.set(node.name.text, code.slice(node.getStart(sf), node.end));
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
}

function loadDiscord() {
    const { scripts, page } = indexCache();
    assert.ok(page, "Discord's cache doesn't have its page; open Discord once");
    const readScript = file => scripts.has(file) ? cacheBody(scripts.get(file)) : null;
    const files = currentFiles(cacheBody(page.file), readScript);
    const modules = new Map();
    let cached = 0;
    for (const file of files) {
        const code = readScript(file);
        if (code == null) continue;
        cached++;
        modulesOf(code, modules);
    }
    return { modules: [...modules.values()], coverage: `${cached} of ${files.length} scripts of the current version cached` };
}

// What mod/ and plugins/ look for, read from their source: patches, lookups and CSS classes.

const sourceFiles = dir => readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(f => f.isFile() && /\.tsx?$/.test(f.name)).map(f => join(f.parentPath, f.name));
const strings = args => args.length && args.every(ts.isStringLiteral) ? args.map(a => a.text) : null;
const callee = call => ts.isIdentifier(call.expression) ? call.expression.text
    : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : "";

/** The name of the lookup a call belongs to: the first argument of the nearest enclosing `lazyX("Name", …)`. */
function lookupName(node) {
    for (let p = node.parent; p; p = p.parent)
        if (ts.isCallExpression(p) && p.arguments[0] && ts.isStringLiteral(p.arguments[0])) return p.arguments[0].text;
    return "?";
}

function filterOf(node) {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return { kind: "custom function" };
    return { kind: node.expression.name.text, args: strings(node.arguments) };
}

function wanted() {
    const patches = [], lookups = [];
    for (const file of SOURCES.flatMap(dir => sourceFiles(dir))) {
        const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const visit = node => {
            if (ts.isCallExpression(node)) {
                const name = callee(node), args = node.arguments;
                if (name === "push" && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText() === "patches" && ts.isObjectLiteralExpression(args[0])) {
                    const prop = key => args[0].properties.find(p => p.name?.getText() === key)?.initializer;
                    const literal = prop("match").text;
                    const slash = literal.lastIndexOf("/");
                    patches.push({ name: prop("name").text, find: prop("find").text, match: new RegExp(literal.slice(1, slash), literal.slice(slash + 1)) });
                } else if (name === "store" && strings(args)) {
                    lookups.push({ name: args[0].text, kind: "byStoreName", args: [args[0].text] });
                } else if (name === "find" && args[0] && filterOf(args[0]).args !== null && lookupName(node) !== "?") {
                    lookups.push({ name: lookupName(node), ...filterOf(args[0]) });
                } else if (name === "findInModule" && ts.isStringLiteral(args[0])) {
                    const filter = filterOf(args[1]);
                    lookups.push({ name: lookupName(node), kind: "findInModule", module: args[0].text, args: filter.args ?? [] });
                } else if (name === "findCssClasses" && strings(args)) {
                    lookups.push({ name: `classes ${strings(args).join(", ")}`, kind: "css", args: strings(args) });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return { patches, lookups };
}

// Static checks: what each runtime lookup needs from a module's source. They can't prove a lookup works, only spot one
// that can no longer work.
const word = name => new RegExp(`(?<![\\w$])${name}(?![\\w$])`);
const cssClass = name => new RegExp(`(?<=["\\s])${name}_[\\w-]+(?=["\\s])`);
const CHECKS = {
    byCode: (src, codes) => codes.every(c => src.includes(c)),
    componentByCode: (src, codes) => codes.every(c => src.includes(c)),
    byProps: (src, props) => props.every(p => word(p).test(src)),
    byStoreName: (src, [name]) => src.includes(`"${name}"`),
    css: (src, names) => names.every(n => cssClass(n).test(src))
};

const discord = loadDiscord();
const { patches, lookups } = wanted();

test(`Discord's code: ${discord.coverage}, ${discord.modules.length} modules`, () => {
    assert.ok(discord.modules.length > 1000, "Too few modules: the cache doesn't hold the current version");
    assert.ok(patches.length && lookups.length, "No patches or pieces found in the code of mod/");
});

for (const patch of patches) {
    test(`patch: ${patch.name}`, () => {
        const targets = discord.modules.filter(src => src.includes(patch.find));
        assert.equal(targets.length, 1, `${targets.length} modules contain its find (${discord.coverage})`);
        assert.match(targets[0], canonicalize(patch.match), "its match no longer fits the module");
    });
}

for (const lookup of lookups) {
    const label = `piece: ${lookup.name} (${lookup.kind}${lookup.kind === "byProps" ? ", names only" : ""})`;
    if (lookup.kind === "findInModule") {
        test(label, () => assert.ok(
            discord.modules.some(src => src.includes(lookup.module) && CHECKS.byCode(src, lookup.args)),
            `no module has what it looks for (${discord.coverage})`));
    } else if (CHECKS[lookup.kind] && lookup.args) {
        test(label, () => assert.ok(
            discord.modules.some(src => CHECKS[lookup.kind](src, lookup.args)),
            `no module has what it looks for (${discord.coverage})`));
    } else {
        test(label, { skip: "only checked with Discord open (settings modal)" }, () => { });
    }
}
