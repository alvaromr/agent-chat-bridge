// @vitest-environment happy-dom
// What the CLI reads (mod/src/renderer/read.ts, through compose.ts as the CLI's requests reach it) on a fake Discord:
// a chat's loaded messages in the CLI's shape, the one request of --fetch, the older pages of --more and --older, and
// the messages a `watch` hears. Run with `pnpm test`.
import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

import { channel, FluxDispatcher, loaded, MessageActions, MessageManager, reset, state } from "./fake-discord.mjs";
import { main, native } from "./fake-native.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

// Typed loosely: each test reads the fields of the answer it expects.
const { compose } = /** @type {any} */ (await import("../mod/src/renderer/compose.ts"));
const { forwardWatchedMessages } = await import("../mod/src/renderer/read.ts");

const T = Date.UTC(2026, 10, 5, 10);
// Discord ids are numbers, as mentions write them (`<@111>`).
const ana = { id: "111", username: "ana99", globalName: "Ana" };

/** A message as Discord's MessageStore keeps it, by Ana unless said otherwise. */
const message = (id, fields = {}) => ({
    id, channel_id: "dm1", content: "", author: ana, timestamp: new Date(T + Number(id) * 60_000), editedTimestamp: null, attachments: [],
    embeds: [], reactions: [], mentions: [], mentionRoles: [], mentionEveryone: false, state: "SENT", ...fields
});
/** One message as the CLI gets it, with what every message says. */
const shown = (id, fields = {}) => ({
    id, autor: "Ana", yo: false, fecha: new Date(T + Number(id) * 60_000).toISOString(), texto: "", adjuntos: [], sinLeer: true, meMencionan: false, ...fields
});

beforeEach(() => {
    reset();
    vi.useRealTimers();
    state.users.set(ana.id, ana);
    state.privateChannels.push(channel({ id: "dm1", type: 1, recipients: [ana.id], lastMessageId: "3" }));
    state.guilds.set("s1", { id: "s1", name: "Server" });
    state.guildChannels.set("s1", ["c1"]);
    state.channels.set("c1", channel({ id: "c1", type: 0, name: "general", guild_id: "s1" }));
    state.channels.set("333", channel({ id: "333", type: 0, name: "otro", guild_id: "s1" }));
});

const read = req => compose({ read: "dm1", ...req });

test("read: a chat the user doesn't have, or one whose messages Discord hasn't loaded from the network, says so", async () => {
    assert.deepEqual(await compose({ read: "nada" }), { ok: false, error: "No encuentro ese chat" });
    const notFetched = { ok: false, error: "Discord no tiene cargados los mensajes de ese chat; repite con --fetch" };
    assert.deepEqual(await read({}), notFetched);
    for (const more of [{ ready: false }, { cached: true }, { loadingMore: true }]) {
        loaded("dm1", [message("1")], more);
        assert.deepEqual(await read({}), notFetched, JSON.stringify(more));
    }
    assert.equal(MessageManager.fetchMessages.mock.calls.length, 0);
});

test("read: --fetch makes the one request opening the chat makes, and reads once it arrives", async () => {
    loaded("dm1", [message("1")], { cached: true });
    const answer = await read({ fetch: true });
    assert.deepEqual(MessageManager.fetchMessages.mock.calls, [[{ guildId: null, channelId: "dm1" }]]);
    assert.equal(answer.ok, true);
    loaded("c1", [], { ready: false });
    await compose({ read: "c1", fetch: true });
    assert.deepEqual(MessageManager.fetchMessages.mock.calls[1], [{ guildId: "s1", channelId: "c1" }]);
});

test("read: a --fetch whose page never arrives fails after Discord's time to confirm", async () => {
    vi.useFakeTimers();
    MessageManager.fetchMessages.mockImplementation(() => { });
    const answer = read({ fetch: true });
    await vi.advanceTimersByTimeAsync(8000);
    assert.deepEqual(await answer, { ok: false, error: "Discord no cargó los mensajes de ese chat" });
});

test("read: each message in the CLI's shape, with the chat, the counts and whether more exist", async () => {
    state.readStates.set("dm1", { ack: "1" });
    loaded("dm1", [message("1", { content: "hola" }), message("2", { author: { id: "me", username: "yo", global_name: "Yo" }, content: "qué tal" })], { hasMoreBefore: true });
    assert.deepEqual(await read({}), {
        ok: true, chat: { id: "dm1", kind: "dm", label: "Ana" },
        mensajes: [shown("1", { texto: "hola", sinLeer: false }), shown("2", { autor: "Yo", yo: true, texto: "qué tal" })],
        cargados: 2, sinLeerCargados: 1, paginasExtra: 0, hayMasAntiguos: true, rangoCompleto: true, masSinLeerSinCargar: false
    });
});

test("read: authors by display name or user name, edits, attachments, embeds and reactions", async () => {
    loaded("dm1", [message("1", {
        author: { id: "x", username: "solo" },
        editedTimestamp: new Date(T),
        attachments: [{ filename: "a.png", content_type: "image/png", url: "u1" }, { filename: "b", contentType: "text/plain", url: "u2" }],
        embeds: [{ title: "Título" }],
        reactions: [{ emoji: { id: null, name: "👍" }, count: 2, me: true }]
    })]);
    assert.deepEqual((await read({})).mensajes, [shown("1", {
        autor: "solo", editado: new Date(T).toISOString(),
        adjuntos: [{ nombre: "a.png", tipo: "image/png", url: "u1" }, { nombre: "b", tipo: "text/plain", url: "u2" }],
        embeds: [{ titulo: "Título", campos: [] }],
        reacciones: [{ emoji: "👍", total: 2, mia: true }]
    })]);
});

test("read: a message missing optional fields still reads", async () => {
    loaded("dm1", [{ id: "1", author: ana, timestamp: new Date(T + 60_000) }]);
    assert.deepEqual((await read({})).mensajes, [shown("1")]);
});

test("read: a reply names the message it answers, with its author and start when Discord has it loaded", async () => {
    const long = `<@111> ${"x".repeat(300)}`;
    loaded("dm1", [
        message("1", { content: long }),
        message("2", { messageReference: { message_id: "1", channel_id: "dm1" } }),
        message("3", { messageReference: { message_id: "1" } }),
        message("4", { messageReference: { message_id: "99" } }),
        message("5", { messageReference: { channel_id: "dm1" } }),
        message("6", { content: undefined }),
        message("7", { messageReference: { message_id: "6" } })
    ]);
    const [, two, three, four, five, , seven] = (await read({})).mensajes;
    assert.deepEqual(seven.respondeA, { id: "6", autor: "Ana", extracto: "" }, "an answer to a message with only attachments");
    const excerpt = `@Ana ${"x".repeat(300)}`.slice(0, 200);
    assert.deepEqual(two.respondeA, { id: "1", autor: "Ana", extracto: excerpt });
    assert.deepEqual(three.respondeA, { id: "1", autor: "Ana", extracto: excerpt });
    assert.deepEqual(four.respondeA, { id: "99" });
    assert.equal(five.respondeA, undefined);
});

test("read: mentions read as names, and say whether they mention the user, by name, role or everyone", async () => {
    state.members.set("s1/me", { roles: ["222"] });
    state.roles.set("s1/222", { name: "equipo" });
    loaded("c1", [
        message("1", { channel_id: "c1", content: "<@111> <@&222> <#333> <@999>", mentions: ["111"] }),
        message("2", { channel_id: "c1", mentions: [{ id: "me" }] }),
        message("6", { channel_id: "c1", mentions: ["me"] }),
        // As MESSAGE_CREATE carries them, in the API's own field names.
        message("3", { channel_id: "c1", mentionRoles: undefined, mention_roles: ["222"] }),
        message("4", { channel_id: "c1", mentionEveryone: undefined, mention_everyone: true }),
        message("5", { channel_id: "c1", mentionRoles: ["444"] })
    ]);
    const messages = (await compose({ read: "c1" })).mensajes;
    assert.equal(messages[0].texto, "@Ana @equipo #otro <@999>");
    assert.deepEqual(messages.map(m => m.meMencionan), [false, true, true, true, true, false]);
    loaded("dm1", [message("1", { content: "<@&222>", mentionRoles: ["222"] })]);
    const [dm] = (await read({})).mensajes;
    assert.deepEqual([dm.texto, dm.meMencionan], ["<@&222>", false], "in a DM there are no roles");
});

test("read: a server where the user has no member entry has no roles of theirs", async () => {
    loaded("c1", [message("1", { channel_id: "c1", mentionRoles: ["222"] })]);
    assert.equal((await compose({ read: "c1" })).mensajes[0].meMencionan, false);
});

test("read: --more loads older pages as scrolling up, pausing between them, until the first read message", async () => {
    vi.useFakeTimers();
    state.readStates.set("dm1", { ack: "5" });
    loaded("dm1", [message("9")], { hasMoreBefore: true });
    state.older.set("dm1", [{ messages: [message("8")], more: true }, { messages: [message("4")], more: true }, { messages: [message("2")], more: true }]);
    const answer = read({ more: true });
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(MessageActions.fetchMessages.mock.calls.length, 1);
    await vi.advanceTimersByTimeAsync(1499);
    assert.equal(MessageActions.fetchMessages.mock.calls.length, 1, "it waits as a person reading");
    await vi.advanceTimersByTimeAsync(1);
    const result = await answer;
    assert.deepEqual(MessageActions.fetchMessages.mock.calls, [
        [{ channelId: "dm1", before: "9", limit: 50 }], [{ channelId: "dm1", before: "8", limit: 50 }]
    ]);
    assert.equal(result.paginasExtra, 2);
    assert.equal(result.cargados, 3);
});

test("read: --more stops at 3 pages, or when there are no older ones", async () => {
    vi.useFakeTimers();
    loaded("dm1", [message("9")], { hasMoreBefore: true });
    state.older.set("dm1", [8, 7, 6, 5].map(id => ({ messages: [message(String(id))], more: true })));
    const answer = read({ more: true });
    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal((await answer).paginasExtra, 3);
    loaded("dm1", [message("9")], { hasMoreBefore: true });
    state.older.set("dm1", [{ messages: [message("8")], more: false }]);
    const last = read({ more: true });
    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal((await last).paginasExtra, 1);
});

test("read: --older loads that many pages, read or not; a page that brings nothing ends the loading", async () => {
    vi.useFakeTimers();
    state.readStates.set("dm1", { ack: "99" });
    loaded("dm1", [message("9")], { hasMoreBefore: true });
    state.older.set("dm1", [{ messages: [message("8")], more: true }, { messages: [], more: true }, { messages: [message("6")], more: true }]);
    const answer = read({ older: 3 });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await answer;
    assert.equal(result.paginasExtra, 2);
    assert.equal(MessageActions.fetchMessages.mock.calls.length, 2);
    assert.equal(result.cargados, 2);
});

/** The read's answer, letting fake time pass until it comes, and how long it took. */
async function timedRead(req) {
    const start = Date.now();
    let done = false;
    const answer = read(req).finally(() => void (done = true));
    while (!done) await vi.advanceTimersByTimeAsync(50);
    return { answer: await answer, ms: Date.now() - start };
}

test("read: each older page is waited for until Discord has loaded it, and no longer", async () => {
    vi.useFakeTimers();
    loaded("dm1", [message("9")], { hasMoreBefore: true });
    state.older.set("dm1", [{ messages: [message("8")], more: true, arrives: 300, done: 600 }]);
    const { answer, ms } = await timedRead({ older: 1 });
    assert.equal(answer.cargados, 2);
    assert.ok(ms >= 600 && ms < 1000, `${ms} ms: until Discord ends the loading, not as the messages show`);
    loaded("dm1", [message("9")], { hasMoreBefore: true });
    state.older.set("dm1", [{ messages: [], more: true, arrives: 300 }]);
    const empty = await timedRead({ older: 1 });
    assert.equal(empty.answer.cargados, 1);
    assert.ok(empty.ms >= 8000, `${empty.ms} ms: a page that brings nothing is waited for as long as Discord gets`);
});

test("read: no older page is asked for a chat with no messages loaded", async () => {
    loaded("dm1", [], { hasMoreBefore: true });
    assert.equal((await read({ older: 1 })).paginasExtra, 0);
    assert.equal(MessageActions.fetchMessages.mock.calls.length, 0);
});

test("watch: nothing is listened to until a chat is watched; then new, edited and deleted messages of watched chats go out once", async () => {
    vi.useFakeTimers();
    main.watched = [];
    forwardWatchedMessages();
    assert.equal(FluxDispatcher.subscribe.mock.calls.length, 0, "nothing watched, nothing subscribed");
    main.watch?.(["dm1"]);
    main.watch?.(["dm1"]);
    assert.deepEqual(FluxDispatcher.subscribe.mock.calls.map(([type]) => type), ["MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE"]);
    const chat = { id: "dm1", kind: "dm", label: "Ana" };
    const emitted = () => native.emitWatchEvent.mock.calls.map(([event]) => event);
    native.emitWatchEvent.mockClear();

    await FluxDispatcher.dispatch({ type: "MESSAGE_CREATE", channelId: "dm1", message: message("1", { state: "SENDING" }) });
    await FluxDispatcher.dispatch({ type: "MESSAGE_CREATE", channelId: "dm1", message: message("1", { content: "hola" }) });
    await FluxDispatcher.dispatch({ type: "MESSAGE_CREATE", channelId: "dm1", message: message("1", { content: "hola" }) });
    await FluxDispatcher.dispatch({ type: "MESSAGE_CREATE", channelId: "c1", message: message("2") });
    await FluxDispatcher.dispatch({ type: "MESSAGE_CREATE", channelId: "dm1" });
    await FluxDispatcher.dispatch({ type: "MESSAGE_CREATE", channelId: "dm1", message: message("5", { content: "otro" }) });
    assert.deepEqual(emitted(), [
        { evento: "mensaje", chat, mensaje: shown("1", { texto: "hola" }) }, { evento: "mensaje", chat, mensaje: shown("5", { texto: "otro" }) }
    ]);

    native.emitWatchEvent.mockClear();
    const edited = new Date(T).toISOString();
    loaded("dm1", [message("1", { content: "editado", editedTimestamp: new Date(T) })]);
    const update = fields => FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { channel_id: "dm1", edited_timestamp: edited, ...fields } });
    await update({ id: "1" });
    await update({ id: "1", edited_timestamp: null });
    await update({ id: "7", author: ana, timestamp: new Date(T + 7 * 60_000), content: "suelto" });
    await update({ id: "8" });
    await update({ id: "2", channel_id: "c1" });
    await FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE" });
    assert.deepEqual(emitted(), [], "the edit is read once Discord has applied it");
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(emitted(), [
        { evento: "editado", chat, mensaje: shown("1", { texto: "editado", editado: edited }) },
        { evento: "editado", chat, mensaje: shown("7", { texto: "suelto", editado: edited }) }
    ], "from the store, or as the update came when the store doesn't have it; never without an author");

    native.emitWatchEvent.mockClear();
    await FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", id: "1", channelId: "dm1" });
    await FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", id: "1", channelId: "dm1" });
    await FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", id: "2", channelId: "c1" });
    await FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", id: "5", channelId: "dm1" });
    assert.deepEqual(emitted(), [{ evento: "borrado", chat, id: "1" }, { evento: "borrado", chat, id: "5" }]);

    native.emitWatchEvent.mockClear();
    main.watch?.(["c1"]);
    await FluxDispatcher.dispatch({ type: "MESSAGE_CREATE", channelId: "c1", message: message("7", { channel_id: "c1" }) });
    assert.deepEqual(emitted().map(e => e.chat), [{ id: "c1", kind: "canal", label: "#general · Server" }], "each event with its own chat");

    native.emitWatchEvent.mockClear();
    main.watch?.([]);
    await FluxDispatcher.dispatch({ type: "MESSAGE_CREATE", channelId: "dm1", message: message("3") });
    assert.deepEqual(emitted(), [], "a chat no longer watched");
});
