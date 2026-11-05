// Rendering and input for the tests of what mod/ and the plugins show, in happy-dom (`@vitest-environment happy-dom`).
// Assertions compare what an element says (its text, attributes, or `===` as a boolean), never the element itself: a
// failing assert prints its values, and printing a happy-dom node walks the whole document until the worker runs out
// of memory.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach } from "vitest";

const mounted = new Set();
afterEach(() => {
    for (const unmount of [...mounted]) unmount();
});

/** Renders a React element in its own element of the body; unmounted after the test. */
export function render(element) {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    act(() => root.render(element));
    const unmount = () => {
        mounted.delete(unmount);
        act(() => root.unmount());
        container.remove();
    };
    mounted.add(unmount);
    return { container, rerender: next => act(() => root.render(next)), unmount };
}

/** A key press on the element, as the keyboard sends it: keydown, bubbling and cancelable. Returns the event. */
export function keydown(target, key, init = {}) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    act(() => void target.dispatchEvent(event));
    return event;
}

/** A click, or another mouse event, on the element, inside act(). */
export function mouse(target, type = "click") {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    act(() => void target.dispatchEvent(event));
    return event;
}

/** A field's new value, as typing or picking it would leave it, so React's onChange sees it. */
export function type(input, value) {
    const proto = Object.getPrototypeOf(input);
    act(() => {
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

/** A checkbox click. */
export const toggle = checkbox => mouse(checkbox);

/**
 * The first element the selector matches, or null; typed loosely, as tests read any element's properties.
 * @param {string} selector @param {ParentNode} [root] @returns {any}
 */
export const $ = (selector, root = document) => root.querySelector(selector);
/** Every element the selector matches. @param {string} selector @param {ParentNode} [root] @returns {any[]} */
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Text of the element, collapsed. */
export const text = element => element.textContent.replace(/\s+/g, " ").trim();
