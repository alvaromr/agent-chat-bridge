// Buttons in the toolbar shown when hovering a message: the patch that adds them, and their rendering.
import type { ComponentType } from "react";

import { API_REF, popoverButtons } from "../renderer/registry";
import { patches } from "../renderer/webpack";
import type { Message } from "./discordTypes";
import { ErrorBoundary } from "./ErrorBoundary";

export interface MessagePopoverButtonItem {
    label: string;
    icon: ComponentType<any>;
    onClick?(): void;
}

export type MessagePopoverButtonFactory = (message: Message) => MessagePopoverButtonItem | null;

patches.push({
    name: "botonera del mensaje",
    // The MESSAGE_UTILITIES_A11Y_LABEL text key, hashed as Discord ships it.
    find: ".Lv7LxN),children",
    match: /(?<=\]\}\)),(.{0,40}togglePopout:.+?\}\))\]\}\):null,(?<=\((\i\.\i|\i),\{label:.+?:null,(\i)\?\(0,\i\.jsxs?\)\(\i\.Fragment.+?message:(\i).+?)/,
    replace: (_, ReactButton, ButtonComponent, showReactButton, message) =>
        `]}):null,${API_REF}._buildPopoverElements(${ButtonComponent},${message}),${showReactButton}?${ReactButton}:null,`
});

function PopoverButtons({ Component, message }: { Component: ComponentType<MessagePopoverButtonItem>; message: Message; }) {
    return (
        <>
            {Array.from(popoverButtons, ([key, render]) => {
                try {
                    const item = render(message);
                    return item && <ErrorBoundary key={key}><Component {...item} /></ErrorBoundary>;
                } catch (err) {
                    console.error(`[discord-mod] The ${key} message button failed`, err);
                    return null;
                }
            })}
        </>
    );
}

/** Called from Discord's patched toolbar with its own button component. */
export function _buildPopoverElements(Component: ComponentType<MessagePopoverButtonItem>, message: Message) {
    return <PopoverButtons Component={Component} message={message} />;
}
