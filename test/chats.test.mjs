// @vitest-environment happy-dom
// The chats the CLI can name and the `list` and `unread` answers (mod/src/renderer/chats.ts, through compose.ts as the
// CLI's requests reach it), on a fake Discord. Run with `pnpm test`.
import "./fake-native.mjs";

import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

import { channel, reset, state } from "./fake-discord.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

const { allCandidates, resolve, userName } = await import("../mod/src/renderer/chats.ts");
// Typed loosely: each test reads the fields of the answer it expects.
const { compose } = /** @type {any} */ (await import("../mod/src/renderer/compose.ts"));

/** A Discord id created at that time. */
const at = ms => String((BigInt(ms) - 1420070400000n) << 22n);
const DAY = 86_400_000, NOW = Date.UTC(2026, 10, 5);

/** The user's chats: a DM, a DM with someone Discord doesn't know, two groups, and a server's channels and threads. */
function world() {
    state.users.set("ana", { id: "ana", username: "ana99", globalName: "Ana García" });
    state.users.set("bea", { id: "bea", username: "bea", globalName: null });
    state.nicknames.set("ana", "Anita");
    state.privateChannels.push(
        channel({ id: "dm1", type: 1, recipients: ["ana"], lastMessageId: at(NOW - DAY) }),
        channel({ id: "dm2", type: 1, recipients: ["nadie"], lastMessageId: null }),
        channel({ id: "g1", type: 3, name: "Familia", recipients: ["ana", "bea"], lastMessageId: at(NOW - 3 * DAY) }),
        channel({ id: "g2", type: 3, name: "", recipients: ["ana", "bea", "nadie"], lastMessageId: at(NOW - 2 * DAY) }),
        channel({ id: "g3", type: 3, name: "Vacío", recipients: [], lastMessageId: null }),
        channel({ id: "other", type: 99 })
    );
    state.guilds.set("s1", { id: "s1", name: "Trabajo Ñ" });
    state.guildChannels.set("s1", ["c1", "c2", "voz", "oculto", "perdido"]);
    for (const ch of [
        channel({ id: "c1", type: 0, name: "general", guild_id: "s1", lastMessageId: at(NOW - 5 * DAY) }),
        channel({ id: "c2", type: 5, name: "anuncios", guild_id: "s1", lastMessageId: undefined }),
        channel({ id: "voz", type: 2, name: "voz", guild_id: "s1" }),
        channel({ id: "oculto", type: 0, name: "___hidden___", guild_id: "s1" })
    ]) state.channels.set(ch.id, ch);
    state.hidden.add("oculto");
    state.threads.set("s1", {
        c1: { h1: { channel: channel({ id: "h1", type: 11, name: "Hilo", parent_id: "c1", lastMessageId: at(NOW - 4 * DAY) }) } },
        x: { h2: { channel: channel({ id: "h2", type: 11, name: "Huérfano", parent_id: "borrado", lastMessageId: null }) },
            h3: { channel: channel({ id: "h3", type: 11, name: "Suelto", parent_id: null }) } }
    });
}

beforeEach(() => {
    reset();
    world();
});

test("chats: a DM by its person's names, nickname first; one with an unknown person by its id", () => {
    const [dm1, dm2] = allCandidates();
    assert.deepEqual(dm1, { id: "dm1", kind: "dm", label: "Anita", names: ["Anita", "Ana García", "ana99"], lastMessageId: at(NOW - DAY) });
    assert.deepEqual(dm2, { id: "dm2", kind: "dm", label: "dm2", names: [], lastMessageId: "0" });
    assert.deepEqual(userName("bea"), ["bea"]);
    assert.deepEqual(userName(undefined), []);
    assert.deepEqual(userName("nadie"), []);
});

test("chats: a group by its name, or by its members' when it has none", () => {
    const groups = allCandidates().filter(c => c.kind === "grupo");
    assert.deepEqual(groups, [
        { id: "g1", kind: "grupo", label: "Familia", names: ["Familia"], weak: ["Anita", "bea"], lastMessageId: at(NOW - 3 * DAY) },
        { id: "g2", kind: "grupo", label: "Anita, bea", names: [], weak: ["Anita", "bea"], lastMessageId: at(NOW - 2 * DAY) },
        { id: "g3", kind: "grupo", label: "Vacío", names: ["Vacío"], weak: [], lastMessageId: "0" }
    ]);
});

test("chats: a server's text and announcement channels the user can see, and its joined threads", () => {
    const server = allCandidates().filter(c => c.guildId);
    assert.deepEqual(server, [
        { id: "c1", kind: "canal", label: "#general · Trabajo Ñ", names: ["general", "Trabajo Ñ general"], lastMessageId: at(NOW - 5 * DAY), guildId: "s1", server: "Trabajo Ñ" },
        { id: "c2", kind: "canal", label: "#anuncios · Trabajo Ñ", names: ["anuncios", "Trabajo Ñ anuncios"], lastMessageId: "0", guildId: "s1", server: "Trabajo Ñ" },
        { id: "h1", kind: "hilo", label: "Hilo · #general · Trabajo Ñ", names: ["Hilo", "Trabajo Ñ Hilo"], lastMessageId: at(NOW - 4 * DAY), guildId: "s1", server: "Trabajo Ñ" },
        { id: "h2", kind: "hilo", label: "Huérfano · # · Trabajo Ñ", names: ["Huérfano", "Trabajo Ñ Huérfano"], lastMessageId: "0", guildId: "s1", server: "Trabajo Ñ" },
        { id: "h3", kind: "hilo", label: "Suelto · # · Trabajo Ñ", names: ["Suelto", "Trabajo Ñ Suelto"], lastMessageId: "0", guildId: "s1", server: "Trabajo Ñ" }
    ]);
});

test("chats: one is found by id, or by a name that picks it, or else the candidates come back", () => {
    assert.equal(resolve({ channelId: "c1" }).chat?.id, "c1");
    assert.deepEqual(resolve({ channelId: "nada" }), { candidates: [], searched: { dm: 2, grupo: 3, canal: 2, hilo: 3 } });
    assert.equal(resolve({ channelId: "nada" }).chat, undefined);
    assert.equal(resolve({ query: "anita" }).chat?.id, "dm1");
    assert.deepEqual(resolve({ query: "h" }).candidates.map(c => c.id).sort(), ["h1", "h2"]);
    assert.throws(() => resolve({}), { message: "[agent-chat-bridge] A draft names its chat by id or by name; validate.ts checks it" });
});

const list = async req => (await compose({ list: true, ...req })).chats.map(c => c.id);

test("list: every chat, most recent first, as id, kind and label", async () => {
    const answer = await compose({ list: true });
    assert.equal(answer.ok, true);
    assert.deepEqual(answer.chats[0], { id: "dm1", kind: "dm", label: "Anita" });
    assert.deepEqual(await list({}), ["dm1", "g2", "g1", "h1", "c1", "dm2", "g3", "c2", "h2", "h3"]);
});

test("list: by kind, by server name in any case and accent, and by the time of the last message", async () => {
    assert.deepEqual(await list({ kinds: ["grupo", "hilo"] }), ["g2", "g1", "h1", "g3", "h2", "h3"]);
    assert.deepEqual(await list({ kinds: [] }), await list({}));
    assert.deepEqual(await list({ server: " trabajo n" }), ["h1", "c1", "c2", "h2", "h3"]);
    assert.deepEqual(await list({ server: "otro" }), []);
    assert.deepEqual(await list({ since: NOW - 3 * DAY }), ["dm1", "g2", "g1"]);
    assert.deepEqual(await list({ until: NOW - 3 * DAY }), ["h1", "c1"]);
    assert.deepEqual(await list({ since: NOW - 4 * DAY, until: NOW - 2 * DAY }), ["g1", "h1"]);
});

test("unread: the chats with unread messages, with their counts and whether they are muted", async () => {
    state.readStates.set("dm1", { unread: 2, mentions: 1 });
    state.readStates.set("c1", { unread: 5, mentions: 0 });
    state.readStates.set("h1", { unread: 1, mentions: 0 });
    state.readStates.set("g1", { unread: 0, mentions: 0 });
    state.muted.add("dm1");
    state.muted.add("h1");
    const answer = await compose({ unread: true });
    assert.equal(answer.ok, true);
    assert.deepEqual(answer.sinLeer, [
        { id: "dm1", kind: "dm", label: "Anita", mensajes: 2, menciones: 1, silenciado: true },
        { id: "h1", kind: "hilo", label: "Hilo · #general · Trabajo Ñ", mensajes: 1, menciones: 0, silenciado: true },
        { id: "c1", kind: "canal", label: "#general · Trabajo Ñ", mensajes: 5, menciones: 0, silenciado: false }
    ]);
    state.muted.clear();
    state.muted.add("s1");
    assert.deepEqual((await compose({ unread: true, kinds: ["canal"] })).sinLeer.map(c => c.silenciado), [true], "a muted server mutes its channels");
});
