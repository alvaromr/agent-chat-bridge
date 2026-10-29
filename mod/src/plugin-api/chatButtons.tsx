// Buttons left of the gift icon in the chat box: the patch that makes room for them, and the button component.
import type { JSX, MouseEventHandler, ReactNode } from "react";

import { API_REF, chatBarButtons } from "../renderer/registry";
import { openSettingsModal } from "../renderer/SettingsModal";
import { findCssClasses, patches } from "../renderer/webpack";
import { Clickable, Tooltip } from "./discord";
import type { Channel } from "./discordTypes";
import { ErrorBoundary } from "./ErrorBoundary";

export interface ChatBarProps {
    channel: Channel;
    disabled: boolean;
    isEmpty: boolean;
    type: { analyticsName: string; };
}

export type ChatBarButtonFactory = (props: ChatBarProps & { isMainChat: boolean; isAnyChat: boolean; }) => JSX.Element | null;

patches.push({
    name: "botones de la caja de texto",
    find: '"sticker")',
    match: /0===(\i)\.length(?=.{0,25}?\(0,\i\.jsxs?\)\(.{0,75}?children:\1)/,
    replace: `(${API_REF}._injectButtons($1,arguments[0]),$&)`
});

function ChatBarButtons(props: ChatBarProps) {
    const { analyticsName } = props.type;
    return (
        <>
            {Array.from(chatBarButtons, ([key, Button]) => (
                <ErrorBoundary key={key}>
                    <Button {...props} isMainChat={analyticsName === "normal"} isAnyChat={["normal", "sidebar"].includes(analyticsName)} />
                </ErrorBoundary>
            ))}
        </>
    );
}

/** Called from Discord's patched chat box with its button list. */
export function _injectButtons(buttons: ReactNode[], props: ChatBarProps) {
    if (props.disabled || buttons.length === 0) return;
    buttons.unshift(<ChatBarButtons key="discord-mod-chat-buttons" {...props} />);
}

export interface ChatBarButtonProps {
    children: ReactNode;
    tooltip: string;
    onClick: MouseEventHandler;
    /** Defaults to opening the mod settings. */
    onContextMenu?: MouseEventHandler;
}

let classes: { wrapper: Record<"button" | "buttonWrapper" | "notificationDot", string>; textArea: Record<"buttonContainer" | "channelTextArea" | "button", string>; } | undefined;

export function ChatBarButton({ children, tooltip, onClick, onContextMenu = openSettingsModal }: ChatBarButtonProps) {
    classes ??= {
        wrapper: findCssClasses("button", "buttonWrapper", "notificationDot"),
        textArea: findCssClasses("buttonContainer", "channelTextArea", "button")
    };
    const text = onContextMenu === openSettingsModal ? `${tooltip} · clic derecho: ajustes` : tooltip;

    return (
        <ErrorBoundary>
            <Tooltip text={text}>
                {({ onMouseEnter, onMouseLeave }) => (
                    <div className={`expression-picker-chat-input-button ${classes!.textArea.buttonContainer}`}>
                        <Clickable
                            aria-label={tooltip}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            className={`${classes!.wrapper.button} ${classes!.textArea.button}`}
                            onClick={onClick}
                            onContextMenu={onContextMenu}
                        >
                            <div className={classes!.wrapper.buttonWrapper}>{children}</div>
                        </Clickable>
                    </div>
                )}
            </Tooltip>
        </ErrorBoundary>
    );
}
