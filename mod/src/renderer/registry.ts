// What the plugins register, kept apart from the plugins so the plugin API modules can read it without importing them.
import { APP_NAME } from "../name.mts";
import type { ChatBarButtonFactory } from "../plugin-api/chatButtons";
import type { MessagePopoverButtonFactory } from "../plugin-api/messagePopover";
import type { PluginDef } from "../plugin-api/plugin";

/** How patched Discord code reaches the mod: a symbol key keeps it out of plain property listings of window. */
export const API_REF = `window[Symbol.for("${APP_NAME}")]`;

export const plugins: PluginDef[] = [];
export const chatBarButtons = new Map<string, ChatBarButtonFactory>();
export const popoverButtons = new Map<string, MessagePopoverButtonFactory>();
