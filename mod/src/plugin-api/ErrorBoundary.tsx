// Renders nothing instead of breaking Discord's UI when a plugin component throws.
import type { ComponentType, ReactNode } from "react";

import { React } from "./discord";

type Props = { children?: ReactNode; };

// Built on first render: React.Component only exists once Discord's React has loaded.
let Boundary: ComponentType<Props> | undefined;

export function ErrorBoundary({ children }: Props) {
    Boundary ??= class extends React.Component<Props, { error?: unknown; }> {
        override state: { error?: unknown; } = {};
        static getDerivedStateFromError(error: unknown) {
            return { error };
        }
        override componentDidCatch(error: unknown) {
            console.error("[discord-mod] A plugin component failed", error);
        }
        override render() {
            return this.state.error ? null : this.props.children;
        }
    };
    return <Boundary>{children}</Boundary>;
}
