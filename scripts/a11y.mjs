// Accessibility checks of what mod/ adds to Discord (`pnpm a11y`), in the running Discord over the DevTools port, as
// docs/debugging.md (method 4) explains: names, keyboard paths and contrast, in the dark and the light theme.
// Prints only check names and measures, never chat names or messages. It needs an open chat with an empty box, and
// presses only Tab and Shift+Tab, Enter and Space on the Autorespuesta button, Shift+F10, the right arrow on the
// settings tabs and Escape. It leaves Discord
// as it found it: selection mode off, the settings modal closed, the theme Discord had.
import { connectToDiscord } from "./devtools.mjs";

const CHAT_BUTTONS = ["Corregir ortografía", "Generar respuesta", "Dictar (o mantén Espacio)"];
const MESSAGE_BUTTONS = ["Corregir ortografía", "Generar respuesta desde aquí"];
const TEXT_RATIO = 4.5;
const EDGE_RATIO = 3;

const discord = await connectToDiscord();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** @param {string} expression */
async function evaluate(expression) {
    const { result, exceptionDetails } = await discord.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
}

const KEY_CODES = { Tab: 9, Enter: 13, Escape: 27, " ": 32, ArrowRight: 39, F10: 121 };
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

let failures = 0;
/** @param {string} name @param {boolean} passed @param {unknown} [measure] */
function check(name, passed, measure) {
    console.log(`${passed ? "ok  " : "FAIL"} ${name}${measure === undefined ? "" : `: ${JSON.stringify(measure)}`}`);
    if (!passed) failures++;
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

/** Puts the focus in the chat box; Discord's editor takes it a moment after focus(), so this waits for it. */
async function focusBox() {
    for (let i = 0; i < 10; i++) {
        await evaluate(`${BOX}.focus()`);
        await sleep(200);
        if (await evaluate(focused) === "(box)") return;
    }
    throw new Error("The chat box doesn't take the focus");
}

const theme = await evaluate("document.documentElement.classList.contains('theme-light') ? 'theme-light' : 'theme-dark'");
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

try {
    if (!(await evaluate(`!!${BOX} && !!${chatButton(CHAT_BUTTONS[0])}`))) throw new Error("Open a chat in Discord first");
    if (await evaluate(`${BOX}.textContent.replace(/\\uFEFF/g, "").length`) !== 0) throw new Error("The open chat's box is not empty");

    // Chat box buttons: role, name and the keyboard path from the box.
    for (const label of CHAT_BUTTONS) {
        const ax = await nameOf(chatButton(label));
        check(`chat box button «${label}» is a named button`, ax?.role === "button" && ax.name === label, ax);
    }
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
        check(`Tab from the box reaches «${label}» with a focus ring`, at === label && ring, { at, ring });
    }

    // Autorespuesta: Enter and Space start the message selection, Escape ends it, and the hover outline shows.
    const selecting = "document.body.classList.contains('dm-autoreply-selecting')";
    for (const key of /** @type {const} */ (["Enter", " "])) {
        await evaluate(`${chatButton(CHAT_BUTTONS[1])}.focus()`);
        await press(key);
        const started = await evaluate(selecting);
        await press("Escape");
        check(`${key === " " ? "Space" : key} starts the selection and Escape ends it`, started && !(await evaluate(selecting)));
    }

    // The message toolbar: Shift+Tab from the box enters the last message at its end, and goes on back through its
    // toolbar.
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
    check("the keyboard reaches the plugin buttons of a message's toolbar", reached.includes(MESSAGE_BUTTONS[1]), reached);

    for (const name of [theme, theme === "theme-dark" ? "theme-light" : "theme-dark"]) {
        await setTheme(name);
        await sleep(300);
        const label = `${name.replace("theme-", "")} theme`;

        // Selection outline over a hovered message.
        await evaluate(`${chatButton(CHAT_BUTTONS[1])}.click()`);
        const box = await evaluate(`(() => { const r = ${LAST_MESSAGE}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await discord.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...box });
        await sleep(200);
        const outline = await evaluate(`(() => { ${CONTRAST} const m = ${LAST_MESSAGE}; const s = getComputedStyle(m);
            return s.outlineStyle === "none" ? 0 : ratio(s.outlineColor, m); })()`);
        await press("Escape");
        check(`${label}: the selection outline stands out from the message`, outline >= EDGE_RATIO, outline);

        // Settings modal: opened from the keyboard at the button's tab, every field named, contrast, the tabs' arrow keys,
        // and Escape back to the button.
        await evaluate(`${chatButton(CHAT_BUTTONS[1])}.focus()`);
        await press("F10", SHIFT);
        await sleep(400);
        check(`${label}: Shift+F10 opens the settings with the focus inside`,
            await evaluate(`!!${MODAL} && !!document.activeElement.closest('[role=dialog]')`));
        const SELECTED_TAB = "document.querySelector('.dm-settings [role=tab][aria-selected=true]')";
        check(`${label}: the settings open at the button's plugin`, await evaluate(`${SELECTED_TAB}?.textContent`) === "Autorespuesta");
        const FIELDS = "document.querySelectorAll('.dm-settings input, .dm-settings textarea')";
        const fields = await evaluate(`${FIELDS}.length`);
        const unnamed = [];
        for (let i = 0; i < fields; i++)
            if (!(await nameOf(`${FIELDS}[${i}]`))?.name) unnamed.push(i);
        check(`${label}: the ${fields} fields have a name`, fields > 0 && unnamed.length === 0, unnamed.length ? { unnamed } : undefined);
        const ratios = await evaluate(`(() => { ${CONTRAST}
            const at = sel => document.querySelector(".dm-settings " + sel);
            const text = Object.fromEntries([["tab", "[role=tab][aria-selected=true]"], ["other tab", "[role=tab][aria-selected=false]"], ["description", ".dm-muted"], ["label", ".dm-label"], ["reset", ".dm-reset"], ["number", "input[type=number]"]]
                .filter(([, sel]) => at(sel)).map(([name, sel]) => [name, ratio(getComputedStyle(at(sel)).color, at(sel))]));
            const number = at("input[type=number]");
            const tab = at("[role=tab][aria-selected=true]");
            return { text, edge: number ? ratio(getComputedStyle(number).borderTopColor, number.parentElement) : null,
                tab: ratio(getComputedStyle(tab).borderBottomColor, tab) };
        })()`);
        check(`${label}: the settings text reaches ${TEXT_RATIO}:1`, Object.values(ratios.text).every(r => r >= TEXT_RATIO), ratios.text);
        check(`${label}: the number field's edge reaches ${EDGE_RATIO}:1`, ratios.edge === null || ratios.edge >= EDGE_RATIO, ratios.edge);
        check(`${label}: the selected tab's underline reaches ${EDGE_RATIO}:1`, ratios.tab >= EDGE_RATIO, ratios.tab);
        await evaluate(`${SELECTED_TAB}.focus()`);
        await press("ArrowRight");
        const moved = await evaluate(`(() => { const t = ${SELECTED_TAB}; return { tab: t?.textContent, focused: document.activeElement === t,
            panel: document.getElementById(t?.getAttribute("aria-controls"))?.getAttribute("aria-labelledby") === t?.id }; })()`);
        check(`${label}: the right arrow selects and focuses the next tab, with its panel`,
            moved.tab !== "Autorespuesta" && moved.focused && moved.panel, moved);
        await press("Escape");
        await sleep(300);
        check(`${label}: Escape closes the settings and the focus goes back to the button`,
            !(await evaluate(`!!${MODAL}`)) && await evaluate(focused) === CHAT_BUTTONS[1]);
    }
} finally {
    await setTheme(theme);
    if (await evaluate("document.body.classList.contains('dm-autoreply-selecting')")) await press("Escape");
    if (await evaluate(`!!${MODAL}`)) await press("Escape");
    discord.close();
}
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
