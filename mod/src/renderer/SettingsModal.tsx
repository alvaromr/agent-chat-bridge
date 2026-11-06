// Settings of every plugin in one modal, one tab each, opened by right-clicking a plugin button in the chat box at that
// plugin's tab, built from each plugin's settings definition.
import type { KeyboardEvent } from "react";

import { APP_NAME } from "../name.mts";
import { Modal, openModal, showToast, TextArea, useState } from "../plugin-api/discord";
import type { RenderModalProps } from "../plugin-api/discordTypes";
import { OptionType } from "../plugin-api/plugin";
import type { SettingDef } from "../plugin-api/settings";
import { plugins } from "./registry";
import { savedSettings, saveSettings } from "./settings";
import { patches } from "./webpack";

interface Field {
    key: string;
    def: SettingDef;
    value: SettingDef["default"];
}

/** A tab per plugin with settings, with its fields' current values. */
const currentTabs = () => plugins.flatMap(({ name, description, settings, notice }) => settings ? [{
    name,
    description,
    notice: notice?.() ?? null,
    fields: Object.entries(settings.def).map(([key, def]): Field => ({
        key,
        def,
        // The store already falls back to the default; its generic type can't say so.
        value: settings.store[key] as SettingDef["default"]
    }))
}] : []);

/** What the modal and its toasts say. */
const TEXT = {
    title: `Ajustes de ${APP_NAME}`,
    patches: (list: string) => `Parches: ${list}`,
    patchStatus: { ok: "✓", failed: "✗ falló", pending: "pendiente" },
    reset: "Restablecer",
    cancel: "Cancelar",
    save: "Guardar",
    saved: "Ajustes guardados",
    saveFailed: (err: unknown) => `No se pudieron guardar los ajustes: ${err}`
} as const;

function Input({ def, value, onChange }: { def: SettingDef; value: SettingDef["default"]; onChange(value: SettingDef["default"]): void; }) {
    switch (def.type) {
        case OptionType.BOOLEAN:
            return <input type="checkbox" checked={value as boolean} onChange={e => onChange(e.currentTarget.checked)} />;
        case OptionType.NUMBER:
            return <input type="number" min={0} value={value as number} onChange={e => onChange(e.currentTarget.valueAsNumber || 0)} />;
        case OptionType.STRING: {
            if (!def.options) return <TextArea value={value as string} onChange={onChange} rows={def.multiline ? 6 : 1} autosize />;
            // The saved value stays selectable when it is no longer offered, so opening the modal doesn't change it.
            const options = [...new Set([...def.options(), value as string])];
            return (
                <select value={value as string} onChange={e => onChange(e.currentTarget.value)}>
                    {options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
            );
        }
    }
}

/** The tab after a key, as in WAI-ARIA's tabs pattern: arrows wrap around, Home and End go to the ends. */
function nextTab(key: string, at: number, count: number) {
    switch (key) {
        case "ArrowRight": return (at + 1) % count;
        case "ArrowLeft": return (at - 1 + count) % count;
        case "Home": return 0;
        case "End": return count - 1;
        default: return null;
    }
}

function SettingsModal({ rootProps, plugin }: { rootProps: RenderModalProps; plugin: string | undefined; }) {
    const [tabs, setTabs] = useState(currentTabs);
    // The selected tab's index: the given plugin's, or the first.
    const [tab, setTab] = useState(() => Math.max(0, tabs.findIndex(({ name }) => name === plugin)));

    function onTabKey(e: KeyboardEvent<HTMLElement>) {
        const next = nextTab(e.key, tab, tabs.length);
        if (next === null) return;
        e.preventDefault();
        setTab(next);
        (e.currentTarget.children[next] as HTMLElement).focus();
    }

    const set = (name: string, key: string, value: SettingDef["default"]) => setTabs(all => all.map(t => t.name !== name ? t : {
        ...t,
        fields: t.fields.map(f => f.key === key ? { ...f, value } : f)
    }));

    async function save() {
        for (const { name, fields } of tabs) {
            const changed = fields.filter(({ def, value }) => value !== def.default);
            if (changed.length) savedSettings[name] = Object.fromEntries(changed.map(({ key, value }) => [key, value]));
            else delete savedSettings[name];
        }
        try {
            await saveSettings();
            showToast({ text: TEXT.saved, variant: "success" });
            rootProps.onClose();
        } catch (err) {
            showToast({ text: TEXT.saveFailed(err), variant: "critical" });
        }
    }

    return (
        <Modal
            {...rootProps}
            size="lg"
            title={TEXT.title}
            subtitle={TEXT.patches(patches.map(p => `${p.name} ${TEXT.patchStatus[p.status ?? "pending"]}`).join(" · "))}
            actions={[
                { text: TEXT.cancel, variant: "secondary", onClick: rootProps.onClose },
                { text: TEXT.save, variant: "primary", onClick: save }
            ]}
        >
            <div className="dm-settings">
                <div role="tablist" className="dm-tabs" onKeyDown={onTabKey}>
                    {tabs.map(({ name }, i) => (
                        <button
                            key={name}
                            type="button"
                            role="tab"
                            id={`dm-tab-${name}`}
                            aria-controls={`dm-panel-${name}`}
                            aria-selected={i === tab}
                            tabIndex={i === tab ? 0 : -1}
                            onClick={() => setTab(i)}
                        >
                            {name}
                        </button>
                    ))}
                </div>
                {tabs.filter((_, i) => i === tab).map(({ name, description, notice, fields }) => (
                    <section key={name} role="tabpanel" id={`dm-panel-${name}`} aria-labelledby={`dm-tab-${name}`}>
                        {notice && <p className="dm-notice">{notice}</p>}
                        <p className="dm-muted">{description}</p>
                        {fields.map(({ key, def, value }) => (
                            <div key={key} className={def.type === OptionType.BOOLEAN ? "dm-field dm-check" : "dm-field"}>
                                {/* The label wraps the field, which takes its name from it whether it is a native input or Discord's TextArea. */}
                                <label>
                                    <span className="dm-label">{def.description}</span>
                                    <Input def={def} value={value} onChange={next => set(name, key, next)} />
                                </label>
                                {value !== def.default && (
                                    <button type="button" className="dm-reset" onClick={() => set(name, key, def.default)}>{TEXT.reset}</button>
                                )}
                            </div>
                        ))}
                    </section>
                ))}
            </div>
        </Modal>
    );
}

/** Opens the settings at the given plugin's tab, or at the first one. */
export function openSettingsModal(plugin?: string) {
    openModal(props => <SettingsModal rootProps={props} plugin={plugin} />);
}
