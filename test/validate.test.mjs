// What the local socket accepts (mod/src/validate.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { commandOf } from "../mod/src/ipc.ts";
import { isValid, watchRequest } from "../mod/src/validate.ts";
import { buildRequest, COMMANDS } from "../scripts/discord-mod.mjs";

const ok = req => assert.equal(isValid(req), true, JSON.stringify(req));
const no = req => assert.equal(isValid(req), false, JSON.stringify(req));

test("refuses what is not a request", () => {
    for (const req of [null, undefined, 1, "x", [], {}]) no(req);
});

test("list and unread: known kinds only", () => {
    ok({ list: true });
    ok({ unread: true, kinds: ["dm", "grupo", "canal", "hilo"] });
    no({ list: true, kinds: ["servidor"] });
    no({ list: true, kinds: ["dm", "servidor"] });
    no({ unread: true, kinds: "dm" });
    no({ list: "true" });
    no({ unread: 1 });
});

test("shared filters: dates and server", () => {
    ok({ list: true, since: 0, until: Date.now(), server: "mtx" });
    no({ list: true, since: -1 });
    no({ list: true, until: 1.5 });
    ok({ list: true, server: "m" });
    ok({ list: true, server: "x".repeat(100) });
    no({ list: true, server: "" });
    no({ list: true, server: "x".repeat(101) });
});

test("read: a numeric id as text and a limit from 1 to 100", () => {
    ok({ read: "123", limit: 1, fetch: true, more: true, unreadOnly: true });
    ok({ read: "123", limit: 100 });
    no({ read: 123 });
    no({ read: "12a" });
    no({ read: "1".repeat(21) });
    no({ read: "123", limit: 0 });
    no({ read: "123", limit: 101 });
    no({ read: "123", fetch: "yes" });
});

test("read --older: 1 to 3 pages, and not with --more", () => {
    ok({ read: "123", older: 1 });
    ok({ read: "123", older: 3, fetch: true });
    no({ read: "123", older: 0 });
    no({ read: "123", older: 4 });
    no({ read: "123", older: 1.5 });
    no({ read: "123", older: 1, more: true });
});

test.each(["react", "unreact"])("%s: Unicode emojis only, and ids as text", command => {
    const on = reaction => ({ [command]: reaction });
    ok(on({ chatId: "1", messageId: "2", emoji: "👍" }));
    no(on({ chatId: "1", messageId: "2", emoji: ":thumbsup:" }));
    no(on({ chatId: "1", messageId: "2", emoji: "<:custom:3>" }));
    no(on({ chatId: "1", messageId: "2", emoji: "" }));
    ok(on({ chatId: "1", messageId: "2", emoji: "👍".repeat(16) }));
    no(on({ chatId: "1", messageId: "2", emoji: "👍".repeat(16) + "!" }));
    no(on({ chatId: "1", messageId: "2", emoji: ["👍"] }));
    no(on({ chatId: 1, messageId: "2", emoji: "👍" }));
    no(on({ chatId: "1", messageId: 2, emoji: "👍" }));
    no(on(null));
});

test("draft --clear: only the chat, with no text, attachments or reply", () => {
    ok({ channelId: "1", clear: true });
    ok({ query: "nacho", clear: true, dryRun: true });
    ok({ query: "x".repeat(200), clear: true });
    no({ query: "x".repeat(201), clear: true });
    no({ clear: true });
    no({ channelId: "1", clear: false });
    no({ channelId: "1", clear: true, text: "hola" });
    no({ channelId: "1", clear: true, attach: ["/tmp/a.png"] });
    no({ channelId: "1", clear: true, replyTo: "2" });
});

test("edit and delete: ids as text and a non-empty new text", () => {
    ok({ edit: { chatId: "1", messageId: "2", text: "hola" } });
    ok({ delete: { chatId: "1", messageId: "2" } });
    no({ edit: { chatId: "1", messageId: "2", text: "  " } });
    ok({ edit: { chatId: "1", messageId: "2", text: "x".repeat(4000) } });
    no({ edit: { chatId: "1", messageId: "2", text: "x".repeat(4001) } });
    no({ edit: null });
    no({ edit: { chatId: "1", messageId: "2" } });
    no({ edit: { chatId: 1, messageId: "2", text: "hola" } });
    no({ delete: { chatId: "1" } });
    no({ delete: null });
});

test.each(["send", "sendDirect"])("%s: a chat id and the confirmed text", command => {
    ok({ [command]: "1", expect: "hola" });
    ok({ [command]: "1", expect: "" });
    no({ [command]: "1" });
    no({ [command]: "x", expect: "hola" });
    ok({ [command]: "1", expect: "x".repeat(4000) });
    no({ [command]: "1", expect: "x".repeat(4001) });
    no({ [command]: "1", expect: 1 });
});

test("a reply goes only with sendDirect; send replies with what the box holds", () => {
    ok({ sendDirect: "1", expect: "hola", replyTo: "2" });
    no({ sendDirect: "1", expect: "hola", replyTo: "x" });
    no({ send: "1", expect: "hola", replyTo: "2" });
});

test("draft: the chat by name or id, and text or attachments", () => {
    ok({ query: "nacho", text: "hola" });
    ok({ channelId: "1", text: "hola", replyTo: "2", replace: true, dryRun: true, background: true });
    ok({ channelId: "1", attach: ["/tmp/a.png"] });
    ok({ channelId: "1", text: "", attach: ["/tmp/a.png"] });
    no({ channelId: "1", text: "  ", attach: ["/tmp/a.png"] });
    no({ text: "hola" });
    no({ query: "nacho", text: "   " });
    no({ query: "nacho" });
    ok({ query: "x".repeat(200), text: "hola" });
    no({ query: "x".repeat(201), text: "hola" });
    no({ channelId: "1", query: 5, text: "hola" });
    no({ channelId: "abc", text: "hola" });
    no({ query: "nacho", text: "hola", replyTo: "abc" });
    ok({ query: "nacho", text: "x".repeat(4000) });
    no({ query: "nacho", text: "x".repeat(4001) });
});

test("draft: attachments by absolute path, 10 at most, and never files from outside", () => {
    ok({ query: "nacho", attach: Array(10).fill("/tmp/a.png") });
    no({ query: "nacho", attach: ["a.png"] });
    no({ query: "nacho", attach: ["/tmp/a.png", "a.png"] });
    no({ query: "nacho", attach: Array(11).fill("/tmp/a.png") });
    no({ query: "nacho", text: "hola", files: [] });
    no({ query: "nacho", attach: [] });
});

test("a request with several commands is checked as the one the renderer runs", () => {
    const react = { chatId: "1", messageId: "2", emoji: "👍" };
    // The renderer would send: the send must pass its own checks, even next to a valid react.
    no({ send: "x", expect: "hola", react });
    ok({ send: "1", expect: "hola", react });
    no({ list: true, kinds: ["servidor"], read: "1" });
    no({ list: 1, unread: true });
    assert.deepEqual(
        [{ list: true }, { unread: true }, { read: "1" }, { send: "1" }, { sendDirect: "1" }, { react }, { unreact: react },
            { edit: {} }, { delete: {} }, { query: "x" },
            { read: "1", send: "1", react, edit: {}, delete: {} }, { send: "1", sendDirect: "1", react }, { sendDirect: "1", react },
            { react, unreact: react, edit: {} }, { unreact: react, edit: {} }, { edit: {}, delete: {} }].map(commandOf),
        ["list", "unread", "read", "send", "sendDirect", "react", "unreact", "edit", "delete", "draft",
            "read", "send", "sendDirect", "react", "unreact", "edit"]
    );
});

test("every CLI command but watch builds a request the socket accepts, of that command", () => {
    /** Each CLI command's argument lists, with the socket command each one builds. @type {Record<string, [string[], string][]>} */
    const argv = {
        draft: [[["draft", "nacho", "hola"], "draft"]],
        send: [[["send", "1", "hola"], "send"], [["send", "1", "hola", "--direct", "--reply", "2"], "sendDirect"]],
        edit: [[["edit", "1", "2", "hola"], "edit"]],
        delete: [[["delete", "1", "2"], "delete"]],
        react: [[["react", "1", "2", "👍"], "react"], [["react", "1", "2", "👍", "--remove"], "unreact"]],
        list: [[["list"], "list"]], unread: [[["unread"], "unread"]], read: [[["read", "1"], "read"]]
    };
    assert.deepEqual(Object.keys(argv).sort(), Object.keys(COMMANDS).filter(name => name !== "watch").sort());
    for (const [args, command] of Object.values(argv).flat()) {
        const { request } = buildRequest(args);
        ok(request);
        assert.equal(commandOf(request), command, args.join(" "));
    }
});

test("watch: 1 to 10 ids", () => {
    assert.deepEqual(watchRequest('{"watch":["1","2"]}'), ["1", "2"]);
    assert.deepEqual(watchRequest('{"watch":["1"]}'), ["1"]);
    assert.deepEqual(watchRequest(JSON.stringify({ watch: Array(10).fill("1") })), Array(10).fill("1"));
    assert.equal(watchRequest('{"watch":[]}'), null);
    assert.equal(watchRequest(JSON.stringify({ watch: Array(11).fill("1") })), null);
    assert.equal(watchRequest('{"watch":[1]}'), null);
    assert.equal(watchRequest('{"watch":["1",1]}'), null);
    assert.equal(watchRequest('{"list":true}'), null);
    assert.equal(watchRequest("no es json"), null);
});
