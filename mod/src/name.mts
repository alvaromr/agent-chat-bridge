// The project's name, defined once: its folder under Application Support, its IPC channels, its window symbol and the
// prefix of its logs and errors. No imports and only erasable TypeScript, so scripts/acb.mjs loads it with plain Node.
export const APP_NAME = "agent-chat-bridge";

/** The CLI's socket, in the app's folder. */
export const SOCKET_FILE = "compose.sock";
