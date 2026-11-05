// @vitest-environment happy-dom
// The Discord pieces of mod/src/plugin-api/discord.ts, looked up in a made-up webpack runtime (test/fake-webpack.mjs):
// each piece finds its module on first use, among decoys that lack one of the texts or props it looks for, so each of
// them counts; methods stay bound to their store, and a piece Discord no longer has fails naming it. Whether Discord's
// real modules still pass these lookups is what `pnpm check-discord` checks. Run with `pnpm test`.
import assert from "node:assert/strict";
import { runInThisContext } from "node:vm";

import * as RealReact from "react";
import { beforeAll, test, vi } from "vitest";

import { render } from "./dom.mjs";
import { loadedModule, loadWebpack } from "./fake-webpack.mjs";

/** A function whose source is exactly `source`, as Discord's minified code would be. @returns {any} */
const code = source => runInThisContext(`(${source})`);
/** A function that holds these texts in its source and answers with its name and the argument it gets. */
const withTexts = (name, texts) => code(`function (x) { return ["${name}", x, ${texts.map(t => `\`${t}\``).join(", ")}]; }`);
/** One decoy per text: the same function without that text, or with none when it has one. */
const decoys = texts => texts.map((_, i) => withTexts("decoy", texts.filter((__, j) => j !== i)));

/** A store as Discord's are: an instance of a class with the store's name as displayName. */
function store(name, methods = {}) {
    const Store = class { static displayName = name; };
    return Object.assign(new Store(), methods);
}

const STORES = ["ActiveJoinedThreadsStore", "ChannelStore", "DraftStore", "GuildMemberStore", "GuildRoleStore", "GuildStore",
    "PendingReplyStore", "PermissionStore", "ReadStateStore", "RelationshipStore", "MessageStore", "SelectedChannelStore",
    "UploadAttachmentStore", "UserGuildSettingsStore", "UserStore"];
/** The pieces found by their props, and the props. */
const BY_PROPS = {
    DraftType: ["ChannelMessage", "SlashCommand"],
    MessageActions: ["editMessage", "sendMessage"],
    MessageManager: ["loadSelectedChannelIfNecessary", "fetchMessages"],
    DraftActions: ["clearDraft", "saveDraft"],
    FluxDispatcher: ["dispatch", "subscribe", "_actionHandlers"]
};
/** An object with these props, each a method that answers with the object's name. */
const withProps = (name, props) => Object.fromEntries(props.map(p => [p, () => name]));
/** The functions found by their code, and its texts. */
const BY_CODE = {
    showToast: [".currentToastMap.has("],
    addReaction: ['"Message Shortcut"', "MESSAGE_SHORTCUT_ACTION_SENT", '"MESSAGE_REACTION_ADD"'],
    removeReaction: ['"MESSAGE_REACTION_REMOVE"', "useTypeEndpoint:!0"],
    promptToUpload: ["Unexpected mismatch between files and file metadata"]
};
/** Those exported as themselves; promptToUpload goes under UploadHandler. */
const EXPORTED = ["showToast", "addReaction", "removeReaction"];
const forwardRef = render => ({ $$typeof: Symbol.for("react.forward_ref"), render });
const TEXT_AREA = ["!0,rows:", "showRemainingCharacterCount:"];
const MODAL = ["leadingLayout:", "actions:", ".message"];
const CLICKABLE = ["this.context?this.renderNonInteractive():"];

const fake = {
    userStore: store("UserStore", {
        name: "yo",
        getCurrentUser() {
            return this.name;
        }
    }),
    Modal: withTexts("Modal", MODAL),
    TextArea: forwardRef(withTexts("TextArea", TEXT_AREA)),
    Tooltip: class { shouldShowTooltip() { } render() { } },
    Clickable: forwardRef(withTexts("Clickable", CLICKABLE)),
    transitionToChannel: withTexts("transitionToChannel", [".openTextInVoiceIfVoiceChannel"]),
    openModal: withTexts("openModal", [",instant:"])
};

/**
 * The made-up Discord. The decoys come first, as find() and findInModule() take the first match: each lacks one of
 * the texts or props a piece looks for. Two modules are found by their factory's text, after a decoy without it.
 */
function discordModules() {
    /** A module factory whose source holds `marker`, exporting a function without the piece's text, then the piece. */
    const marked = (marker, piece) => code(`(function (piece) {
        return function (module) { const marker = \`${marker}\`; module.exports = { marker, first: function () { return "decoy"; }, piece }; };
    })`)(piece);
    /** A module factory without the marker, exporting a decoy that has the piece's text. */
    const unmarked = text => code("(function (piece) { return function (module) { module.exports = { piece }; }; })")(withTexts("decoy", [text]));
    const wreq = loadWebpack({
        100: unmarked(".openTextInVoiceIfVoiceChannel"),
        101: marked('"Thread must have a parent ID."', fake.transitionToChannel),
        102: unmarked(",instant:"),
        103: marked(".modalKey?", fake.openModal)
    });
    const loaded = [
        { createElement() { } }, { useEffect() { } }, RealReact,
        ...STORES.map(name => name === "UserStore" ? fake.userStore : store(name)),
        ...Object.values(BY_PROPS).flatMap(props => props.map((_, i) => withProps("decoy", props.filter((__, j) => j !== i)))),
        ...Object.entries(BY_PROPS).map(([name, props]) => withProps(name, props)),
        { dispatchToLastSubscribed: () => "popout", options: {} }, { options: { logger: {} } },
        { dispatchToLastSubscribed: () => "main", options: { logger: {} } },
        // Each decoy an export of its own, as find() looks one level into a module.
        Object.fromEntries([...Object.values(BY_CODE), MODAL].flatMap(decoys).map((decoy, i) => [`decoy${i}`, decoy])),
        Object.fromEntries(Object.keys(BY_CODE).map(name => [name, withTexts(name, BY_CODE[name])])),
        { a: forwardRef(decoys(TEXT_AREA)[0]), b: forwardRef(decoys(TEXT_AREA)[1]), c: forwardRef(decoys(CLICKABLE)[0]), d: class { render() { } } },
        { Modal: fake.Modal, TextArea: fake.TextArea, Tooltip: fake.Tooltip, Clickable: fake.Clickable }
    ];
    loaded.forEach((exports, i) => loadedModule(wreq, i, exports));
    return wreq;
}

/** @type {any} */
let discord;
beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => { });
    await import("../mod/src/renderer/webpack.ts");
    discordModules();
    discord = await import("../mod/src/plugin-api/discord.ts");
});

test("discord: React is Discord's, and its hooks are React's", () => {
    assert.equal(discord.React.createElement, RealReact.createElement);
    assert.equal(discord.React.Component, RealReact.Component, "classes stay as they are");
    const seen = [];
    function Probe() {
        const [value] = discord.useState(() => "estado");
        discord.useEffect(() => void seen.push(value), []);
        return null;
    }
    render(RealReact.createElement(Probe));
    assert.deepEqual(seen, ["estado"]);
});

test("discord: each store is the one with its name, and its methods keep it as `this`", () => {
    for (const name of STORES) assert.equal(discord[name].constructor.displayName, name, name);
    const { getCurrentUser } = discord.UserStore;
    assert.equal(getCurrentUser(), "yo");
    assert.equal(discord.UserStore.name, "yo");
});

test("discord: the actions and helpers are the modules with all their props", () => {
    for (const [name, props] of Object.entries(BY_PROPS))
        for (const prop of props) assert.equal(discord[name][prop](), name, `${name}.${prop}`);
});

test("discord: the chat box's dispatcher is the main instance, the one with a logger", () => {
    assert.equal(discord.ComponentDispatch.dispatchToLastSubscribed(), "main");
});

test("discord: functions found by all of their code are called with the arguments given", () => {
    for (const name of EXPORTED) assert.deepEqual(discord[name]("x").slice(0, 2), [name, "x"], name);
    assert.deepEqual(discord.UploadHandler.promptToUpload("x").slice(0, 2), ["promptToUpload", "x"]);
    assert.deepEqual(discord.ChannelRouter.transitionToChannel("5").slice(0, 2), ["transitionToChannel", "5"]);
    assert.deepEqual(discord.openModal("r").slice(0, 2), ["openModal", "r"]);
});

test("discord: components render the one found by all of its code, with the props given", () => {
    const props = { title: "t" };
    for (const [name, found] of [["Modal", fake.Modal], ["TextArea", fake.TextArea], ["Tooltip", fake.Tooltip], ["Clickable", fake.Clickable]]) {
        const element = discord[name](props);
        assert.ok(element.type === found, name);
        assert.deepEqual(element.props, props, name);
    }
});

/** discord.ts loaded afresh on a Discord with only these loaded modules. @returns {Promise<any>} */
async function discordWith(...exports) {
    vi.resetModules();
    await import("../mod/src/renderer/webpack.ts");
    const wreq = loadWebpack({});
    exports.forEach((e, i) => loadedModule(wreq, i, e));
    return import("../mod/src/plugin-api/discord.ts");
}

test("discord: a piece Discord no longer has fails on use, naming it", async () => {
    const none = await discordWith();
    assert.throws(() => none.React.createElement, { message: "[agent-chat-bridge] React not found in Discord" });
    const onlyReact = await discordWith(RealReact);
    const uses = {
        ...Object.fromEntries(STORES.map(name => [name, () => onlyReact[name].x])),
        ...Object.fromEntries(Object.keys(BY_PROPS).map(name => [name, () => onlyReact[name].x])),
        ComponentDispatch: () => onlyReact.ComponentDispatch.x,
        ...Object.fromEntries(EXPORTED.map(name => [name, () => onlyReact[name]()])),
        promptToUpload: () => onlyReact.UploadHandler.promptToUpload(),
        transitionToChannel: () => onlyReact.ChannelRouter.transitionToChannel(),
        openModal: () => onlyReact.openModal(),
        ...Object.fromEntries(["Modal", "TextArea", "Tooltip", "Clickable"].map(name => [name, () => onlyReact[name]({})]))
    };
    for (const [name, use] of Object.entries(uses)) assert.throws(use, { message: `[agent-chat-bridge] ${name} not found in Discord` }, name);
});
