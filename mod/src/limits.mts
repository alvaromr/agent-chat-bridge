// Limits that mod/ enforces and the CLI's --help states, defined once. No imports and only erasable TypeScript, so
// scripts/discord-mod.mjs loads it with plain Node; .mts keeps Node from guessing its module type.

/** Rule 3: `send`, `edit`, `delete` and `react` share these, per chat and in total. */
export const MIN_SEND_INTERVAL_MS = 5000;
export const MAX_SENDS_PER_HOUR = 30;

/** Discord's upload limit without Nitro. */
export const MAX_ATTACHMENT_MB = 25;
export const MAX_ATTACHMENTS = 10;

export const MAX_WATCHED_CHATS = 10;

/** Messages `read` returns: by default, and at most (also the default with --unread, --older or dates). */
export const DEFAULT_READ_LIMIT = 20;
export const MAX_READ_LIMIT = 100;
/** Rule 3: --more and --older load at most this many older pages per read. */
export const MAX_EXTRA_PAGES = 3;
