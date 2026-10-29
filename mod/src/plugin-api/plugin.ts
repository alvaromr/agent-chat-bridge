// What a plugin declares: its settings, its buttons and its lifecycle. mod/src/renderer/index.ts registers each one.
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
    stop?(): void;
}

export default function definePlugin<P extends PluginDef>(plugin: P) {
    return plugin;
}
