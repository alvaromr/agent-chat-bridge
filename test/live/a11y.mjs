// Live accessibility checks of what mod/ adds to Discord (`pnpm live`), in the running Discord over the DevTools port,
// as docs/debugging.md (method 4) explains: only what Discord itself decides, in the dark and the light theme. Its
// buttons' roles and names, its keyboard paths and focus rings, its modal's focus and Escape, and the contrast of the
// colours it computes. What mod/ renders (the tabs' pattern, the fields' labels, the keys of the tabs) is in the unit
// tests (test/settings-modal.test.mjs, test/chat-buttons.test.mjs).
// Prints only check names and measures, never chat names or messages. It needs an open chat with an empty box, and
// presses only Tab and Shift+Tab, Enter and Space on the Autorespuesta button, Shift+F10 and Escape. It leaves Discord
// as it found it: selection mode off, the settings modal closed, the theme Discord had.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { connectToDiscord } from "../../scripts/devtools.mjs";

const CHAT_BUTTONS = ["Corregir ortografía", "Generar respuesta", "Dictar (o mantén Espacio)"];
const MESSAGE_BUTTONS = ["Corregir ortografía", "Generar respuesta desde aquí"];
const TEXT_RATIO = 4.5;
const EDGE_RATIO = 3;

/** @type {Awaited<ReturnType<typeof connectToDiscord>>} */
let discord;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** @param {string} expression */
async function evaluate(expression) {
    const { result, exceptionDetails } = await discord.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
}

const KEY_CODES = { Tab: 9, Enter: 13, Escape: 27, " ": 32, F10: 121 };
const SHIFT = 8;
/** A real key press, as the keyboard sends it. @param {keyof typeof KEY_CODES} key */
async function press(key, modifiers = 0) {
    const code = key === " " ? "Space" : key;
    const base = { key, code, windowsVirtualKeyCode: KEY_CODES[key], nativeVirtualKeyCode: KEY_CODES[key], modifiers };
    await discord.send("Input.dispatchKeyEvent", { type: key === "Enter" || key === " " ? "keyDown" : "rawKeyDown", ...base,
        ...key === "Enter" ? { text: "\r" } : key === " " ? { text: " " } : {} });
    await discord.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(400);
}

/** The accessible name Chromium gives the element an expression returns. @param {string} expression */
async function nameOf(expression) {
    const { result } = await discord.send("Runtime.evaluate", { expression, returnByValue: false });
    if (!result.objectId) return undefined;
    const { nodes } = await discord.send("Accessibility.getPartialAXTree", { objectId: result.objectId, fetchRelatives: false });
    return { role: nodes[0]?.role?.value, name: nodes[0]?.name?.value };
}

// Page side: any CSS colour to sRGB through a canvas, composed over the backgrounds behind the element, and the WCAG ratio.
const CONTRAST = `
    const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
    const srgb = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    const over = ([r, g, b, a], base) => [r, g, b].map((v, i) => v * a / 255 + base[i] * (1 - a / 255));
    const backdrop = el => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(srgb(getComputedStyle(e).backgroundColor)); return chain.reverse().reduce((base, c) => over(c, base), [255, 255, 255]); };
    const lum = rgb => rgb.map(v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (color, el) => { const bg = backdrop(el), [x, y] = [lum(over(srgb(color), bg)), lum(bg)].sort((p, q) => q - p); return Math.round((x + 0.05) / (y + 0.05) * 100) / 100; };
`;
const BOX = "document.querySelector('[role=\"textbox\"][data-slate-editor]')";
const chatButton = label => `document.querySelector('[class*="channelTextArea"] [aria-label="${label}"]')`;
const MODAL = "document.querySelector('[role=dialog] .dm-settings')";
const LAST_MESSAGE = "[...document.querySelectorAll('[id^=\"chat-messages-\"]')].at(-1)";
const focused = "(() => { const a = document.activeElement; return a.closest('[role=textbox]') ? '(box)' : a.getAttribute('aria-label'); })()";
const SELECTING = "document.body.classList.contains('dm-autoreply-selecting')";

/** Puts the focus in the chat box; Discord's editor takes it a moment after focus(), so this waits for it. */
async function focusBox() {
    for (let i = 0; i < 10; i++) {
        await evaluate(`${BOX}.focus()`);
        await sleep(200);
        if (await evaluate(focused) === "(box)") return;
    }
    throw new Error("The chat box doesn't take the focus");
}

let theme = "";
// Only in the page, never in Discord's settings: every element with Discord's theme class gets the other one, and an
// observer keeps it on what React renders afterwards, until the theme Discord had comes back.
const OBSERVER = "window[Symbol.for('agent-chat-bridge-a11y')]";
/** @param {string} to */
const setTheme = to => evaluate(`(() => {
    ${OBSERVER}?.disconnect();
    const from = "${to}" === "theme-dark" ? "theme-light" : "theme-dark";
    const swap = () => document.querySelectorAll("." + from).forEach(e => e.classList.replace(from, "${to}"));
    swap();
    if ("${to}" === "${theme}") return void delete ${OBSERVER};
    ${OBSERVER} = new MutationObserver(swap);
    ${OBSERVER}.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
})()`);

before(async () => {
    discord = await connectToDiscord();
    theme = await evaluate("document.documentElement.classList.contains('theme-light') ? 'theme-light' : 'theme-dark'");
    assert.ok(await evaluate(`!!${BOX} && !!${chatButton(CHAT_BUTTONS[0])}`), "Open a chat in Discord first");
    assert.equal(await evaluate(`${BOX}.textContent.replace(/\\uFEFF/g, "").length`), 0, "The open chat's box is not empty");
});
after(async () => {
    await setTheme(theme);
    if (await evaluate(SELECTING)) await press("Escape");
    if (await evaluate(`!!${MODAL}`)) await press("Escape");
    discord.close();
});

test("live a11y: Discord renders each chat box button as a button with its name", async () => {
    for (const label of CHAT_BUTTONS) assert.deepEqual(await nameOf(chatButton(label)), { role: "button", name: label }, label);
});

test("live a11y: Tab from the box reaches each chat box button with Discord's focus ring", async () => {
    // Right after Discord starts, the first Tab only turns on its keyboard mode and leaves the focus in the box, so the
    // path would be a step behind: one Tab and Shift+Tab first, and the path starts from the box again.
    await focusBox();
    await press("Tab");
    await press("Tab", SHIFT);
    await focusBox();
    for (const label of CHAT_BUTTONS) {
        await press("Tab");
        const at = await evaluate(focused);
        const ring = await evaluate(`(() => { const r = document.activeElement.getBoundingClientRect();
            return [...document.querySelectorAll(".focus-rings-ring, [class*='focusRing']")].some(e => { const q = e.getBoundingClientRect(); return q.width > 0 && Math.abs(q.left - r.left) < 8 && Math.abs(q.top - r.top) < 8; }); })()`);
        assert.deepEqual({ at, ring }, { at: label, ring: true }, label);
    }
});

test("live a11y: Enter and Space on Discord's button start the message selection, and Escape ends it", async () => {
    for (const key of /** @type {const} */ (["Enter", " "])) {
        await evaluate(`${chatButton(CHAT_BUTTONS[1])}.focus()`);
        await press(key);
        const started = await evaluate(SELECTING);
        await press("Escape");
        assert.deepEqual({ started, ended: !(await evaluate(SELECTING)) }, { started: true, ended: true }, key === " " ? "Space" : key);
    }
});

test("live a11y: Shift+Tab from the box goes back through the last message's toolbar to the plugins' buttons", async () => {
    await focusBox();
    const reached = [];
    for (let i = 0, entered = false; i < 16 && reached.length < MESSAGE_BUTTONS.length; i++) {
        await press("Tab", SHIFT);
        const inMessage = await evaluate("!!document.activeElement.closest('[id^=\"chat-messages-\"]')");
        if (entered && !inMessage) break;
        entered ||= inMessage;
        const at = await evaluate(focused);
        if (inMessage && MESSAGE_BUTTONS.includes(at) && !reached.includes(at)) reached.push(at);
    }
    assert.ok(reached.includes(MESSAGE_BUTTONS[1]), JSON.stringify(reached));
});

for (const which of ["Discord's theme", "the other theme"]) describe(`live a11y: in ${which}`, () => {
    before(async () => {
        await setTheme(which === "Discord's theme" ? theme : theme === "theme-dark" ? "theme-light" : "theme-dark");
        await sleep(300);
    });

    test("the selection outline stands out from the message", async () => {
        await evaluate(`${chatButton(CHAT_BUTTONS[1])}.click()`);
        const box = await evaluate(`(() => { const r = ${LAST_MESSAGE}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await discord.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...box });
        await sleep(200);
        const outline = await evaluate(`(() => { ${CONTRAST} const m = ${LAST_MESSAGE}; const s = getComputedStyle(m);
            return s.outlineStyle === "none" ? 0 : ratio(s.outlineColor, m); })()`);
        await press("Escape");
        assert.ok(outline >= EDGE_RATIO, String(outline));
    });

    test("Shift+F10 opens the settings in Discord's modal, with the focus inside", async () => {
        await evaluate(`${chatButton(CHAT_BUTTONS[1])}.focus()`);
        await press("F10", SHIFT);
        await sleep(400);
        assert.ok(await evaluate(`!!${MODAL} && !!document.activeElement.closest('[role=dialog]')`));
    });

    test("each settings field gets a name from Chromium, Discord's text areas included", async () => {
        const FIELDS = "document.querySelectorAll('.dm-settings input, .dm-settings textarea')";
        const fields = await evaluate(`${FIELDS}.length`);
        const unnamed = [];
        for (let i = 0; i < fields; i++)
            if (!(await nameOf(`${FIELDS}[${i}]`))?.name) unnamed.push(i);
        assert.ok(fields > 0, "fields");
        assert.deepEqual(unnamed, []);
    });

    test(`the settings text reaches ${TEXT_RATIO}:1, and the number field's edge and the selected tab's underline ${EDGE_RATIO}:1`, async () => {
        const ratios = await evaluate(`(() => { ${CONTRAST}
            const at = sel => document.querySelector(".dm-settings " + sel);
            const text = Object.fromEntries([["tab", "[role=tab][aria-selected=true]"], ["other tab", "[role=tab][aria-selected=false]"], ["description", ".dm-muted"], ["label", ".dm-label"], ["reset", ".dm-reset"], ["number", "input[type=number]"]]
                .filter(([, sel]) => at(sel)).map(([name, sel]) => [name, ratio(getComputedStyle(at(sel)).color, at(sel))]));
            const number = at("input[type=number]");
            const tab = at("[role=tab][aria-selected=true]");
            return { text, edge: number ? ratio(getComputedStyle(number).borderTopColor, number.parentElement) : null,
                tab: ratio(getComputedStyle(tab).borderBottomColor, tab) };
        })()`);
        assert.ok(Object.values(ratios.text).every(r => r >= TEXT_RATIO), JSON.stringify(ratios.text));
        assert.ok(ratios.edge === null || ratios.edge >= EDGE_RATIO, String(ratios.edge));
        assert.ok(ratios.tab >= EDGE_RATIO, String(ratios.tab));
    });

    test("Escape closes Discord's modal and the focus goes back to the button", async () => {
        await press("Escape");
        await sleep(300);
        assert.deepEqual({ open: await evaluate(`!!${MODAL}`), focus: await evaluate(focused) }, { open: false, focus: CHAT_BUTTONS[1] });
    });
});
