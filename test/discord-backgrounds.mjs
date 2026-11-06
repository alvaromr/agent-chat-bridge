// The Discord backgrounds behind what mod/ colours, as CSS: test/discord-css.mjs measures contrast against them, and
// test/live/a11y.mjs checks that the running Discord paints them there.

/** Behind the settings: Discord's modal. */
export const MODAL_BACKGROUND = "var(--modal-background)";
/** Behind a message: the chat's background, either of these, with the hover tint over it or without. */
export const CHAT_BACKGROUNDS = ["var(--background-base-lower)", "var(--chat-background-default)"];
export const MESSAGE_HOVER = "var(--message-background-hover)";
