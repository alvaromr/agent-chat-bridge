// Finding a chat by name and filtering by date (mod/src/renderer/match.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { fold, inRange, match, selectMessages, snowflakeTime } from "../mod/src/renderer/match.ts";

let nextId = 1;
const chat = (kind, names, extra = {}) => ({ id: String(nextId), kind, label: names[0] ?? "", names, lastMessageId: String(nextId++), ...extra });
const ids = r => r.candidates.map(c => c.id);

test("picks a chat when the name matches clearly and only once", () => {
    const nacho = chat("dm", ["Nacho"]);
    assert.equal(match([nacho, chat("dm", ["Marta"])], "nacho").chat, nacho);
    assert.equal(match([nacho], "NACHO ").chat, nacho);
});

test("ignores accents and letter case", () => {
    const angela = chat("dm", ["Ángela"]);
    assert.equal(match([angela], "angela").chat, angela);
    assert.equal(fold("  Ñandú Straße "), "nandu straße");
});

test("the start of a word is enough to pick", () => {
    const bravo = chat("dm", ["Alejandro Bravo"]);
    assert.equal(match([bravo], "bravo").chat, bravo);
    const design = chat("canal", ["Equipo Diseño"]);
    assert.equal(match([design], "diseño").chat, design);
});

test("a name that starts with the query beats one where only a later word does", () => {
    const start = chat("dm", ["Alejandra"]);
    assert.equal(match([chat("dm", ["Pedro Alejandro"]), start], "alej").chat, start);
});

test("a short form doesn't pick on its own: it returns the chat as a candidate", () => {
    const alejandro = chat("dm", ["Alejandro Bravo"]);
    const r = match([alejandro], "alex");
    assert.equal(r.chat, undefined);
    assert.deepEqual(ids(r), [alejandro.id]);
});

test("the text inside a word makes it a candidate, without picking it", () => {
    const pedro = chat("dm", ["Superpedro"]);
    assert.deepEqual(match([pedro], "pedro"), { candidates: [pedro] });
});

test("a short form that drifts from the name is not a candidate", () => {
    assert.deepEqual(match([chat("dm", ["Alejandro Bravo"])], "alexis"), { candidates: [] });
    assert.deepEqual(match([chat("dm", ["Marta"])], "mo"), { candidates: [] });
});

test("on a tie it returns them all, the most recent first", () => {
    const old = chat("dm", ["Alex García"]);
    const recent = chat("dm", ["Alex López"]);
    for (const chats of [[old, recent], [recent, old]]) {
        const r = match(chats, "alex");
        assert.equal(r.chat, undefined);
        assert.deepEqual(ids(r), [recent.id, old.id]);
    }
});

test("a DM wins over a channel with the same name", () => {
    const dm = chat("dm", ["general"]);
    assert.equal(match([chat("canal", ["general"]), dm], "general").chat, dm);
});

test("a group's members count less than a DM's name", () => {
    const dm = chat("dm", ["Nacho"]);
    const group = chat("grupo", [], { weak: ["Nacho", "Marta"] });
    assert.equal(match([group, dm], "nacho").chat, dm);
    assert.equal(match([group], "marta").chat, group);
});

test("returns nothing without matches", () => {
    assert.deepEqual(match([chat("dm", ["Nacho"])], "zzz"), { candidates: [] });
});

test("returns 30 candidates at most", () => {
    const many = Array.from({ length: 40 }, (_, i) => chat("canal", [`alex${i}`]));
    assert.equal(match(many, "alex").candidates.length, 30);
});

test("snowflakeTime counts from Discord's epoch", () => {
    assert.equal(snowflakeTime("0"), 1420070400000);
    assert.equal(snowflakeTime(String(1n << 22n)), 1420070400001);
});

test("inRange includes since and excludes until", () => {
    assert.equal(inRange(10, { since: 10, until: 20 }), true);
    assert.equal(inRange(20, { since: 10, until: 20 }), false);
    assert.equal(inRange(9, { since: 10 }), false);
    assert.equal(inRange(9, {}), true);
});

/**
 * A chat's loaded messages, oldest first, one a minute; the ids in `unread` are the unread ones.
 * @param {number} count @param {{ hasMoreBefore?: boolean, unread?: string[] }} [options]
 */
const loaded =(count, { hasMoreBefore = false, unread = [] } = {}) => ({
    messages: Array.from({ length: count }, (_, i) => ({ id: String(i), timestamp: new Date(i * 60_000) })),
    hasMoreBefore,
    isUnread: m => unread.includes(m.id)
});
const selectedIds = ({ selected }) => selected.map(m => m.id);

test("read returns the latest 20 by default, or as many as asked", () => {
    assert.deepEqual(selectedIds(selectMessages(loaded(25), {})), Array.from({ length: 20 }, (_, i) => String(i + 5)));
    assert.deepEqual(selectedIds(selectMessages(loaded(25), { limit: 3 })), ["22", "23", "24"]);
});

test("read returns up to 100 by default with unread only, older pages or dates", () => {
    const all = loaded(30, { unread: Array.from({ length: 30 }, (_, i) => String(i)) });
    for (const req of [{ unreadOnly: true }, { older: 1 }, { since: 0 }, { until: 30 * 60_000 }])
        assert.equal(selectMessages(all, req).selected.length, 30, JSON.stringify(req));
});

test("read keeps the messages in the range, and the unread ones when asked", () => {
    const chat = loaded(5, { unread: ["3", "4"] });
    assert.deepEqual(selectedIds(selectMessages(chat, { since: 60_000, until: 3 * 60_000 })), ["1", "2"]);
    assert.deepEqual(selectedIds(selectMessages(chat, { unreadOnly: true })), ["3", "4"]);
    assert.equal(selectMessages(chat, { limit: 1 }).unreadLoaded, 2);
});

test("a range is complete unless it may reach back past the oldest loaded message", () => {
    const complete = (chat, req) => selectMessages(chat, req).rangeComplete;
    assert.equal(complete(loaded(3, { hasMoreBefore: true }), {}), true, "no start");
    assert.equal(complete(loaded(3, { hasMoreBefore: true }), { until: 60_000 }), true, "only an end");
    assert.equal(complete(loaded(3), { since: 60_000 }), true, "nothing older to load");
    assert.equal(complete(loaded(3, { hasMoreBefore: true }), { since: 1 }), true, "the oldest is before the start");
    assert.equal(complete(loaded(3, { hasMoreBefore: true }), { since: 0 }), false, "the oldest is at the start");
    assert.equal(complete(loaded(0, { hasMoreBefore: true }), { since: 0 }), false, "nothing loaded");
});

test("more unread messages exist than loaded when the oldest loaded one is unread and older ones exist", () => {
    const more = chat => selectMessages(chat, {}).moreUnreadNotLoaded;
    assert.equal(more(loaded(3, { hasMoreBefore: true, unread: ["0", "1", "2"] })), true);
    assert.equal(more(loaded(3, { hasMoreBefore: true, unread: ["1", "2"] })), false);
    assert.equal(more(loaded(3, { unread: ["0", "1", "2"] })), false);
    assert.equal(more(loaded(0, { hasMoreBefore: true })), false);
});
