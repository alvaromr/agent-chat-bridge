// Plugin settings as saved by the main process: per plugin, only the values that differ from their default.
export const savedSettings: Record<string, Record<string, unknown>> = window.DiscordModNative.getSettings();

export const saveSettings = () => window.DiscordModNative.setSettings(savedSettings);
