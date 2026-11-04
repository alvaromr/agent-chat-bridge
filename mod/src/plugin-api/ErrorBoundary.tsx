// Renders nothing instead of breaking Discord's UI when a plugin component throws, and tells the user once.
import type { ComponentType, ReactNode } from "react";

import { React, showToast } from "./discord";
import { log } from "./log";

/** The toast that says a plugin's button is missing because it failed. */
const TEXT = {
    failed: (name: string) => `${name} no se pudo mostrar; el detalle está en la consola`
};

const reported = new Set<string>();

/**
 * Logs the failure of the component named `name` and shows the user a toast the first time, so a button that keeps
 * failing on every render or hover doesn't flood the toasts.
 */
export function reportRenderFailure(name: string, error: unknown) {
    log.error(`${name} failed`, error);
    if (reported.has(name)) return;
    reported.add(name);
    // Outside React's render and commit, so the toast's own state update never runs inside them.
    setTimeout(() => showToast({ text: TEXT.failed(name), variant: "critical" }), 0);
}

type Props = { name: string; children?: ReactNode; };

// Built on first render: React.Component only exists once Discord's React has loaded.
let Boundary: ComponentType<Props> | undefined;

export function ErrorBoundary({ name, children }: Props) {
    Boundary ??= class extends React.Component<Props, { error?: unknown; }> {
        override state: { error?: unknown; } = {};
        static getDerivedStateFromError(error: unknown) {
            return { error };
        }
        override componentDidCatch(error: unknown) {
            reportRenderFailure(this.props.name, error);
        }
        override render() {
            return this.state.error ? null : this.props.children;
        }
    };
    return <Boundary name={name}>{children}</Boundary>;
}
