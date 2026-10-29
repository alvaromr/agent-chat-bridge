// A plugin's settings: values come from the settings file, falling back to each default.
import { savedSettings } from "../renderer/settings";
import type { OptionType } from "./plugin";

export interface SettingDef {
    type: OptionType;
    description: string;
    default: string | number | boolean;
    multiline?: boolean;
}

export type SettingsDefinition = Record<string, SettingDef>;

type Widen<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T;

export interface DefinedSettings<D extends SettingsDefinition = SettingsDefinition> {
    def: D;
    /** Set when the plugin is registered. */
    pluginName: string;
    store: { readonly [K in keyof D]: Widen<D[K]["default"]> };
}

export function definePluginSettings<D extends SettingsDefinition>(def: D): DefinedSettings<D> {
    const settings = { def, pluginName: "" } as DefinedSettings<D>;
    settings.store = new Proxy({} as DefinedSettings<D>["store"], {
        get: (_, key: string) => savedSettings[settings.pluginName]?.[key] ?? def[key]?.default
    });
    return settings;
}
