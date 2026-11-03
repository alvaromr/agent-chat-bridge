// A fake of mod/src/plugin-api/discord.ts for the regression tests of Discord-side code: the pieces the modules under
// test import, as stubs that record their calls; the ones no test drives throw if called. A test sets what it needs in
// `state` and reads the calls back.
import { vi } from "vitest";

/** What the fake stores return; each test starts from `reset()`. */
export const state = { me: { id: "me", username: "yo" }, messages: new Map() };

export function reset() {
    state.messages.clear();
    for (const fn of [showToast, MessageActions.editMessage]) fn.mockClear();
}

export const showToast = vi.fn();

export const MessageStore = {
    getMessage: (_channelId, id) => state.messages.get(id),
    getMessages: () => ({ _array: [...state.messages.values()] })
};
export const UserStore = { getCurrentUser: () => state.me, getUser: () => undefined };
export const MessageActions = { editMessage: vi.fn(async () => { }) };

const unused = name => () => {
    throw new Error(`fake-discord: ${name} is not faked; add it`);
};
export const React = { createElement: unused("React.createElement"), Component: class { } };
export const useState = unused("useState");
export const DraftStore = { getDraft: () => "" };
export const DraftType = { ChannelMessage: 0 };
export const ComponentDispatch = { dispatchToLastSubscribed: unused("ComponentDispatch") };
export const SelectedChannelStore = { getChannelId: () => "1" };
export const UploadAttachmentStore = { getUploadCount: () => 0 };
export const openModal = unused("openModal");
export const Modal = unused("Modal");
export const TextArea = unused("TextArea");
export const Tooltip = unused("Tooltip");
export const Clickable = unused("Clickable");
