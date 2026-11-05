// Renderer entry point, run in Discord's page before its own scripts.
import "./webpack"; // installs the webpack hook first

import autorespuesta from "../../../plugins/autorespuesta";
import corrector from "../../../plugins/corrector";
import dictation from "../../../plugins/dictation";
import { APP_NAME } from "../name.mts";
import { _injectButtons } from "../plugin-api/chatButtons";
import { _buildPopoverElements } from "../plugin-api/messagePopover";
import type { PluginDef } from "../plugin-api/plugin";
import { compose } from "./compose";
import { forwardWatchedMessages } from "./read";
import { chatBarButtons, plugins, popoverButtons } from "./registry";
import baseStyle from "./styles.css";

Object.defineProperty(window, Symbol.for(APP_NAME), { value: Object.freeze({ _injectButtons, _buildPopoverElements }) });
window.AgentChatBridgeNative.onComposeRequest(compose);
forwardWatchedMessages();

function addStyle(css: string) {
    const add = () => document.head.append(Object.assign(document.createElement("style"), { textContent: css }));
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add, { once: true });
}

addStyle(baseStyle);

/** Registers a plugin with what it declares, and starts it. Exported for its test. */
export function registerPlugin(plugin: PluginDef) {
    plugins.push(plugin);
    if (plugin.settings) plugin.settings.pluginName = plugin.name;
    if (plugin.chatBarButton) chatBarButtons.set(plugin.name, plugin.chatBarButton.render);
    if (plugin.messagePopoverButton) popoverButtons.set(plugin.name, plugin.messagePopoverButton.render);
    if (plugin.style) addStyle(plugin.style);
    plugin.start?.();
}

for (const plugin of [corrector, autorespuesta, dictation] as PluginDef[]) registerPlugin(plugin);
