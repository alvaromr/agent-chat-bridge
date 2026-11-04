// Plugin settings as saved by the main process: per plugin, only the values that differ from their default.
export const savedSettings: Record<string, Record<string, unknown>> = window.AgentChatBridgeNative.getSettings();

export const saveSettings = () => window.AgentChatBridgeNative.setSettings(savedSettings);
