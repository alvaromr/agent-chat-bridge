// A plugin's settings: values come from the settings file, falling back to each default.
import { savedSettings } from "../renderer/settings";
import type { OptionType } from "./plugin";

export interface SettingDef {
    type: OptionType;
    description: string;
    default: string | number | boolean;
    multiline?: boolean;
    /** A STRING picked from this list, read each time the settings open. */
    options?: () => string[];
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
    const value = (key: string) => savedSettings[settings.pluginName]?.[key] ?? def[key]?.default;
    // Reads like a plain object with every setting, so spreading or destructuring it with a rest keeps them all.
    settings.store = new Proxy({} as DefinedSettings<D>["store"], {
        get: (_, key: string) => value(key),
        has: (_, key) => Object.hasOwn(def, key),
        ownKeys: () => Object.keys(def),
        getOwnPropertyDescriptor: (_, key: string) =>
            Object.hasOwn(def, key) ? { value: value(key), enumerable: true, configurable: true } : undefined
    });
    return settings;
}
