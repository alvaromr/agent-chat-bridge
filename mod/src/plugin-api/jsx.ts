// Injected by esbuild into every renderer file that uses JSX, so it renders with Discord's own React.
import { React } from "./discord";

export const AgentChatBridgeFragment = Symbol.for("react.fragment");
export const AgentChatBridgeCreateElement = (...args: Parameters<typeof React.createElement>) => React.createElement(...args);
