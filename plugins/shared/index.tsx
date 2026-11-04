// Renderer side shared by every plugin that talks to Claude.
import { showToast } from "@plugin-api/discord";
import { log } from "@plugin-api/log";
import type { IconComponent } from "@plugin-api/plugin";

/** The toasts the user sees while Claude answers. */
const TEXT = {
    asking: "Consultando a Claude…",
    failed: (error: string) => `Claude: ${error}`,
    actionFailed: (error: string) => `No se pudo terminar: ${error}`
};

/**
 * Shows the user that an action they started failed, which would otherwise only reach the console. Logs the error's
 * name and text only, never what it carries.
 */
export function reportFailure(err: unknown) {
    const text = err instanceof Error ? err.message : String(err);
    log.error(`A plugin action failed: ${err instanceof Error ? err.name : typeof err}: ${text}`);
    showToast({ text: TEXT.actionFailed(text), variant: "critical" });
}

/** Resolves with Claude's text, or shows a toast and resolves with null. */
export async function askClaude(systemPrompt: string, input: string, model: string) {
    showToast({ text: TEXT.asking });
    const { ok, text } = await window.DiscordModNative.runClaude(systemPrompt, input, model);
    if (ok) return text;
    showToast({ text: TEXT.failed(text), variant: "critical" });
    return null;
}

export const SpellcheckIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg viewBox="0 0 24 24" height={height} width={width} className={className}>
        <path fill="currentColor" d="M12.45 16h2.09L9.43 3H7.57L2.46 16h2.09l1.12-3h5.64l1.14 3zm-6.02-5L8.5 5.48 10.57 11H6.43zm15.16.59l-8.09 8.09L9.83 16l-1.41 1.41 5.09 5.09L23 13l-1.41-1.41z" />
    </svg>
);

export const SparklesIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg viewBox="0 0 24 24" height={height} width={width} className={className}>
        <path fill="currentColor" d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z" />
    </svg>
);
