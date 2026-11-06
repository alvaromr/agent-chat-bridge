// The contrast of what mod/ colours in every Discord theme, from the CSS of the version the app last loaded
// (test/discord-cache.mjs), without opening Discord: the colours mod/'s stylesheets ask for, as each theme's variables
// resolve them, over the backgrounds Discord paints behind them. Run with `pnpm check-discord`. That those backgrounds
// are the ones behind them in the running Discord is checked by `pnpm live` (test/live/a11y.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { CHAT_BACKGROUNDS, MESSAGE_HOVER, MODAL_BACKGROUND } from "./discord-backgrounds.mjs";
import { cacheBody, indexCache } from "./discord-cache.mjs";

const TEXT_RATIO = 4.5;
const EDGE_RATIO = 3;

/** Every `selector { declarations }` block, as [selectors, declarations]; at-rule wrappers are dropped. */
function rulesOf(css) {
    return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, block]) => [
        selector.split(",").map(s => s.trim().replace(/\s+/g, " ")),
        block.split(";").map(d => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]).filter(([p]) => p)
    ]);
}

/** The text between the parenthesis at `open` and its match. */
function inside(text, open) {
    for (let depth = 0, i = open; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
    }
    throw new Error(`unbalanced parentheses in ${text}`);
}

/** Splits on the commas outside parentheses. */
function topLevel(text, separator = ",") {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
        else if (text[i] === separator && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    return [...parts, text.slice(start)].map(p => p.trim());
}

/** The value with every `var(--name, fallback)` replaced by what the variables hold. */
function substitute(value, vars, seen = new Set()) {
    for (let at = value.indexOf("var("); at >= 0; at = value.indexOf("var(")) {
        const args = inside(value, at + 3);
        const [name, ...fallback] = topLevel(args);
        if (seen.has(name)) throw new Error(`${name} refers to itself`);
        const raw = vars.get(name) ?? (fallback.length ? fallback.join(",") : undefined);
        if (raw === undefined) throw new Error(`${name} is not defined`);
        value = value.slice(0, at) + substitute(raw, vars, new Set([...seen, name])) + value.slice(at + 4 + args.length + 1);
    }
    return value;
}

/** `calc()` of the products and quotients Discord writes (`1*4.348%`). */
function calc(value) {
    return value.replace(/calc\(([^()]*)\)/g, (_, expr) => {
        if (!/^[\d.\s*/%]+$/.test(expr)) throw new Error(`unsupported calc(${expr})`);
        const percent = expr.includes("%");
        const [first, ...rest] = expr.replace(/%/g, "").split(/([*/])/).map(t => t.trim());
        let result = Number(first);
        for (let i = 0; i < rest.length; i += 2) result = rest[i] === "*" ? result * Number(rest[i + 1]) : result / Number(rest[i + 1]);
        return percent ? `${result}%` : String(result);
    });
}

const hslToRgb = (h, s, l) => {
    const f = n => {
        const k = (n + h / 30) % 12;
        return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)].map(v => v * 255);
};

/** A resolved CSS colour as [r, g, b, alpha], 0–255 and 0–1; anything else Discord might write fails loudly. */
function parseColor(text) {
    const color = text.trim();
    if (color === "transparent") return [0, 0, 0, 0];
    const hex = color.match(/^#([0-9a-f]{3,8})$/i)?.[1];
    if (hex) {
        const digits = hex.length <= 4 ? [...hex].map(d => d + d) : hex.match(/../g) ?? [];
        const [r, g, b, a = 255] = digits.map(d => parseInt(d, 16));
        return [r, g, b, a / 255];
    }
    const fn = color.match(/^([a-z-]+)\(/)?.[1];
    const args = fn ? inside(color, fn.length) : "";
    if (fn === "color-mix") {
        // Discord mixes in a custom theme colour at 0 % unless the user picked one, which leaves the first colour.
        const [space, first, second] = topLevel(args);
        const amount = part => Number(part.match(/\s(\d+(?:\.\d+)?)%$/)?.[1] ?? NaN);
        if (!space.startsWith("in ") || amount(first) !== 100 || amount(second) !== 0) throw new Error(`unsupported ${color}`);
        return parseColor(first.replace(/\s\d+(?:\.\d+)?%$/, ""));
    }
    if (fn === "hsl" || fn === "hsla" || fn === "rgb" || fn === "rgba") {
        const [channels, alpha = "1"] = args.includes("/") ? args.split("/") : [args];
        const values = channels.split(/[\s,]+/).filter(Boolean);
        const a = alpha.trim().endsWith("%") ? parseFloat(alpha) / 100 : parseFloat(alpha);
        if (fn.startsWith("hsl")) return [...hslToRgb(parseFloat(values[0]), parseFloat(values[1]) / 100, parseFloat(values[2]) / 100), a];
        return [...values.slice(0, 3).map(Number), a];
    }
    throw new Error(`unsupported colour ${color}`);
}

const resolve = (value, vars) => parseColor(calc(substitute(value, vars)));
// Colours as arrays of channels, typed loosely: [r, g, b, alpha] from parseColor(), [r, g, b] once opaque.
/** A colour over an opaque background. @param {any} color @param {any} base */
const over = ([r, g, b, a], base) => [r, g, b].map((v, i) => v * a + base[i] * (1 - a));
const WEIGHTS = /** @type {any} */ ([0.2126, 0.7152, 0.0722]);
/** @param {any[]} rgb */
const luminance = rgb => rgb.map(v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * WEIGHTS[i], 0);
/** The WCAG ratio of a colour over an opaque background, to two decimals. @param {any} color @param {any} background */
function ratio(color, background) {
    const [p, q] = [luminance(over(color, background)), luminance(background)];
    return Math.round((Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05) * 100) / 100;
}

// Discord's themes: each `.theme-<name>` block over `:root`, and its high-contrast block on top where it has one.
const { styles, page } = indexCache();
assert.ok(page, "Discord's cache doesn't have its page; open Discord once");
const sheets = [...(cacheBody(page.file) ?? "").matchAll(/href="\/assets\/([\w.-]+\.css)"/g)].map(m => m[1]);
const discordRules = sheets.flatMap(sheet => styles.has(sheet) ? rulesOf(cacheBody(styles.get(sheet)) ?? "") : []);
const declared = selector => discordRules.filter(([selectors]) => selectors.length === 1 && selectors[0] === selector
    || selectors.join(",") === selector).flatMap(([, declarations]) => declarations);
const names = [...new Set(discordRules.flatMap(([selectors]) => selectors.map(s => s.match(/^\.theme-([a-z]+)$/)?.[1]).filter(Boolean)))];
const themes = names.flatMap(name => {
    const base = [...declared(":root"), ...declared(`.theme-${name}`)];
    const high = declared(`.high-contrast-mode .theme-${name},.high-contrast-mode.theme-${name}`);
    return [{ label: name, declarations: base }, ...high.length ? [{ label: `${name}, high contrast`, declarations: [...base, ...high] }] : []];
}).map(({ label, declarations }) => ({ label, vars: new Map(declarations.filter(([p]) => p.startsWith("--"))) }));

// What mod/ colours, from its own stylesheets: the colour each rule asks for.
const modRules = ["../mod/src/renderer/styles.css", "../plugins/autorespuesta/styles.css"]
    .flatMap(file => rulesOf(readFileSync(new URL(file, import.meta.url), "utf8")));
function modColor(selector, property) {
    const value = modRules.filter(([selectors]) => selectors.includes(selector))
        .flatMap(([, declarations]) => declarations).findLast(([p]) => p === property)?.[1];
    assert.ok(value, `mod/ has no ${property} for ${selector}`);
    // A shorthand (`2px solid var(--x)`): its colour is the var().
    const at = value.indexOf("var(");
    return at < 0 ? value : `var(${inside(value, at + 3)})`;
}
const SETTINGS = ".dm-settings";
const TEXTS = {
    "other tab": [`${SETTINGS} [role="tab"]`, "color"],
    "selected tab": [`${SETTINGS} [role="tab"][aria-selected="true"]`, "color"],
    description: [`${SETTINGS} .dm-muted`, "color"],
    label: [`${SETTINGS} .dm-label`, "color"],
    notice: [`${SETTINGS} .dm-notice`, "color"],
    reset: [`${SETTINGS} .dm-reset`, "color"]
};
const NUMBER = `${SETTINGS} input[type="number"]`;

test(`Discord's themes: ${themes.map(t => t.label).join("; ")}`, () => {
    assert.ok(sheets.length && sheets.every(sheet => styles.has(sheet)), "the page's stylesheets aren't all cached; open Discord once");
    assert.ok(["dark", "light"].every(name => names.includes(name)), "no dark and light themes in Discord's stylesheets");
});

for (const { label, vars } of themes) {
    test(`contrast in ${label}`, () => {
        const [r, g, b, alpha] = resolve(MODAL_BACKGROUND, vars);
        assert.equal(alpha, 1, "Discord's modal background isn't opaque");
        const modal = [r, g, b];
        const numberBackground = over(resolve(modColor(NUMBER, "background"), vars), modal);
        const texts = {
            ...Object.fromEntries(Object.entries(TEXTS).map(([name, [selector, property]]) => [name, ratio(resolve(modColor(selector, property), vars), modal)])),
            number: ratio(resolve(modColor(NUMBER, "color"), vars), numberBackground)
        };
        const edges = {
            "number field's edge": ratio(resolve(modColor(NUMBER, "border"), vars), modal),
            "selected tab's underline": ratio(resolve(modColor(TEXTS["selected tab"][0], "border-bottom-color"), vars), modal)
        };
        const outline = resolve(modColor('.dm-autoreply-selecting [id^="chat-messages-"]:hover', "outline"), vars);
        const hover = resolve(MESSAGE_HOVER, vars);
        const message = Math.min(...CHAT_BACKGROUNDS.flatMap(background => {
            const chat = over(resolve(background, vars), [255, 255, 255]);
            return [ratio(outline, chat), ratio(outline, over(hover, chat))];
        }));
        assert.ok(Object.values(texts).every(r => r >= TEXT_RATIO), `text under ${TEXT_RATIO}:1: ${JSON.stringify(texts)}`);
        assert.ok(Object.values(edges).every(r => r >= EDGE_RATIO), `edge under ${EDGE_RATIO}:1: ${JSON.stringify(edges)}`);
        assert.ok(message >= EDGE_RATIO, `the selection outline reaches ${message}:1 against a message`);
    });
}
