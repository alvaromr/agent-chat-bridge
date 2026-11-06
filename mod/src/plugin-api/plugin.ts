// What a plugin declares: its settings, its buttons and its lifecycle. mod/src/renderer/index.ts registers each one.
// Derived from Vencord (https://github.com/Vendicated/Vencord), Copyright (c) Vendicated and contributors; modified
// since 2026-10-29. GPL-3.0-or-later (LICENSE).
import type { ReactNode } from "react";

import type { ChatBarButtonFactory } from "./chatButtons";
import type { MessagePopoverButtonFactory } from "./messagePopover";
import type { DefinedSettings } from "./settings";

export const enum OptionType {
    STRING,
    NUMBER,
    BOOLEAN
}

type IconProps = { height?: number | string; width?: number | string; className?: string; };
export type IconComponent = (props: IconProps & Record<string, any>) => ReactNode;

export interface PluginDef {
    /** Also the key of its settings in the settings file. */
    name: string;
    description: string;
    settings?: DefinedSettings;
    /** CSS text, added while the plugin runs. */
    style?: string;
    chatBarButton?: { icon: IconComponent; render: ChatBarButtonFactory; };
    messagePopoverButton?: { icon: IconComponent; render: MessagePopoverButtonFactory; };
    start?(): void;
    /** Why the plugin can't work on this machine and how to fix it, shown atop its settings tab; null when it can. */
    notice?(): string | null;
}

export default function definePlugin<P extends PluginDef>(plugin: P) {
    return plugin;
}
