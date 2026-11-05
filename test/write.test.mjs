// @vitest-environment happy-dom
// What the CLI changes in Discord (mod/src/renderer/write.ts, through compose.ts as the CLI's requests reach it) on a
// fake Discord: drafts, and the sends, edits, deletes and reactions the user confirmed, each checked against what
// Discord then shows, under one rate limit. Run with `pnpm test`.
import "./fake-native.mjs";

import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

import {
    addReaction, channel, ChannelRouter, chatBox, ComponentDispatch, DraftActions, FluxDispatcher, loaded, MessageActions, removeReaction, reset,
    state, UploadHandler
} from "./fake-discord.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

// Typed loosely: each test reads the fields of the answer it expects.
const { compose } = /** @type {any} */ (await import("../mod/src/renderer/compose.ts"));

/** Runs the request, letting fake time pass until it answers, as long as Discord's slowest wait. */
async function settle(request) {
    let done = false;
    const answer = compose(request).finally(() => void (done = true));
    for (let waited = 0; !done && waited < 20_000; waited += 50) await vi.advanceTimersByTimeAsync(50);
    return answer;
}
/** The request's answer, and how long it took, in fake time: an answer waits for Discord only as long as needed. */
async function timed(request) {
    const start = Date.now();
    const answer = await settle(request);
    return { answer, ms: Date.now() - start };
}

const ana = { id: "111", username: "ana", globalName: "Ana" };
const message = (id, fields = {}) => ({ id, channel_id: "dm1", content: "hola", author: ana, timestamp: new Date(0), reactions: [], state: "SENT", ...fields });
const mine = (id, fields = {}) => message(id, { author: state.me, ...fields });
const DM = { id: "dm1", kind: "dm", label: "Ana" };

// Two hours apart, so the rate limit of one test never reaches the next.
let clock = Date.UTC(2026, 10, 5);
beforeEach(() => {
    reset();
    vi.useFakeTimers();
    vi.setSystemTime(clock += 7_200_000);
    state.users.set(ana.id, ana);
    const dm = channel({ id: "dm1", type: 1, recipients: [ana.id], lastMessageId: "5" });
    state.privateChannels.push(dm, channel({ id: "dm2", type: 1, recipients: ["222"] }));
    state.users.set("222", { id: "222", username: "anabel" });
    state.channels.set("dm1", dm);
    state.guilds.set("s1", { id: "s1", name: "S" });
    state.guildChannels.set("s1", ["c1"]);
    state.channels.set("c1", channel({ id: "c1", type: 0, name: "general", guild_id: "s1" }));
});

test("draft: a chat no name picks gets the candidates, none matching gets what was searched", async () => {
    assert.deepEqual(await settle({ query: "an", text: "x" }), {
        ok: false, error: "No hay un chat claro: elige uno de los candidatos y repite con --id",
        candidatos: [DM, { id: "dm2", kind: "dm", label: "anabel" }]
    });
    const searched = { dm: 2, grupo: 0, canal: 1, hilo: 0 };
    assert.deepEqual(await settle({ query: "zzz", text: "x" }), { ok: false, error: "Ningún chat encaja con ese nombre", revisados: searched });
    assert.deepEqual(await settle({ channelId: "nada", text: "x" }), { ok: false, error: "No encuentro ese chat", revisados: searched });
});

test("draft: --dry-run only resolves the chat", async () => {
    assert.deepEqual(await settle({ channelId: "dm1", text: "x", dryRun: true }), { ok: true, chat: DM, abierto: false, borradorCargado: false });
    assert.equal(DraftActions.saveDraft.mock.calls.length + ComponentDispatch.dispatchToLastSubscribed.mock.calls.length, 0);
});

test("draft: in the open chat the text goes into its box; in another, as its draft, and Discord opens it", async () => {
    state.selected = "dm1";
    const box = chatBox();
    assert.deepEqual(await settle({ channelId: "dm1", text: "hola" }), { ok: true, chat: DM, abierto: true, borradorCargado: true });
    assert.equal(box.textContent, "hola");
    assert.deepEqual(ComponentDispatch.dispatchToLastSubscribed.mock.calls.at(-1), ["TEXTAREA_FOCUS"]);
    assert.deepEqual(await settle({ channelId: "c1", text: "otro" }), { ok: true, chat: { id: "c1", kind: "canal", label: "#general · S" }, abierto: true, borradorCargado: true });
    assert.deepEqual(DraftActions.saveDraft.mock.calls, [["c1", "otro", 0]]);
    assert.deepEqual(ChannelRouter.transitionToChannel.mock.calls, [["c1"]]);
});

test("draft: a draft Discord doesn't show in time is reported as not loaded", async () => {
    ChannelRouter.transitionToChannel.mockImplementation(() => { });
    assert.deepEqual(await settle({ channelId: "c1" }), { ok: true, chat: { id: "c1", kind: "canal", label: "#general · S" }, abierto: false, borradorCargado: false });
    assert.deepEqual(DraftActions.saveDraft.mock.calls, [["c1", "", 0]], "no text is an empty draft");
});

test("draft: the answer comes as soon as Discord shows the draft, and says not loaded when the box shows another text", async () => {
    const { answer, ms } = await timed({ channelId: "c1", text: "otro" });
    assert.equal(answer.borradorCargado, true);
    assert.ok(ms <= 100, `${ms} ms`);
    assert.equal(FluxDispatcher.dispatch.mock.calls.length, 0, "no reply bar without a reply");
    DraftActions.saveDraft.mockImplementation(() => { });
    state.selected = "1";
    assert.equal((await settle({ channelId: "c1", text: "nuevo", replace: true })).borradorCargado, false, "the chat opened, with another draft");
});

test("draft: attachments are waited for until Discord shows them all, and no longer", async () => {
    const files = [{ name: "a", type: "", data: new Uint8Array() }, { name: "b", type: "", data: new Uint8Array() }];
    const shown = await timed({ channelId: "c1", text: "x", files });
    assert.equal(shown.answer.adjuntos, 2);
    assert.ok(shown.ms <= 100, `${shown.ms} ms`);
    UploadHandler.promptToUpload.mockImplementation((given, ch) => void state.uploads.set(ch.id, given.length - 1));
    state.uploads.delete("c1");
    // Back in another chat, so the draft shows at once and only the attachments are waited for.
    state.selected = "1";
    const partial = await timed({ channelId: "c1", text: "x", files, replace: true });
    assert.equal(partial.answer.borradorCargado, true);
    assert.equal(partial.answer.adjuntos, 1);
    assert.ok(partial.ms >= 3000, `${partial.ms} ms: it waits for the one missing`);
});

test("draft: a chat that already has a draft or attachments keeps them, unless --replace", async () => {
    state.drafts.set("dm1", "antes");
    const kept = { ok: false, error: "Ese chat ya tiene un borrador o adjuntos; repite con --replace para sustituirlo", candidatos: [DM] };
    assert.deepEqual(await settle({ channelId: "dm1", text: "x" }), kept);
    state.drafts.delete("dm1");
    state.uploads.set("dm1", 1);
    assert.deepEqual(await settle({ channelId: "dm1", text: "x" }), kept);
    assert.equal((await settle({ channelId: "dm1", text: "x", replace: true })).ok, true);
});

test("draft: a chat Discord has no channel for, or a reply to a message not loaded, is refused", async () => {
    state.channels.delete("dm1");
    assert.deepEqual(await settle({ channelId: "dm1", text: "x" }), { ok: false, error: "No encuentro ese chat" });
    state.channels.set("dm1", channel({ id: "dm1", type: 1 }));
    assert.deepEqual(await settle({ channelId: "dm1", text: "x", replyTo: "9" }),
        { ok: false, error: "Ese mensaje no está cargado en ese chat; cárgalo antes con read --fetch" });
});

test("draft: a reply opens Discord's reply bar on the message, mentioning its author", async () => {
    const replied = message("4");
    loaded("dm1", [replied]);
    loaded("c1", [message("4", { channel_id: "c1" })]);
    FluxDispatcher.subscribe("CREATE_PENDING_REPLY", ({ channel: ch, message: m }) => void state.pendingReplies.set(ch.id, { message: m }));
    const answer = await settle({ channelId: "dm1", text: "x", replyTo: "4" });
    assert.equal(answer.respondiendo, true);
    const [action] = FluxDispatcher.dispatch.mock.calls[0];
    assert.deepEqual({ ...action, channel: action.channel.id }, { type: "CREATE_PENDING_REPLY", channel: "dm1", message: replied, shouldMention: true, showMentionToggle: false });
    await settle({ channelId: "c1", text: "x", replyTo: "4" });
    assert.equal(FluxDispatcher.dispatch.mock.calls[1][0].showMentionToggle, true, "in a server the mention can be turned off");
    state.pendingReplies.clear();
    FluxDispatcher.dispatch.mockImplementation(async () => { });
    assert.equal((await settle({ channelId: "dm1", text: "x", replyTo: "4", replace: true })).respondiendo, false);
});

test("draft: attachments go through Discord's upload prompt, and the answer counts them", async () => {
    const answer = await settle({ channelId: "dm1", text: "x", files: [{ name: "a.txt", type: "text/plain", data: new Uint8Array([104, 105]) }] });
    assert.equal(answer.adjuntos, 1);
    const [[files, ch, type]] = UploadHandler.promptToUpload.mock.calls;
    assert.deepEqual([files.length, files[0].name, files[0].type, await files[0].text(), ch.id, type], [1, "a.txt", "text/plain", "hi", "dm1", 0]);
    UploadHandler.promptToUpload.mockImplementation(() => { });
    state.uploads.delete("dm1");
    assert.equal((await settle({ channelId: "dm1", text: "x", replace: true, files: [{ name: "b", type: "", data: new Uint8Array() }] })).adjuntos, 0);
});

test("draft --clear empties the open chat's box, or another chat's draft", async () => {
    state.selected = "dm1";
    const box = chatBox("algo");
    assert.deepEqual(await settle({ channelId: "dm1", clear: true }), { ok: true, chat: DM, vaciado: true });
    assert.equal(box.textContent, "");
    state.drafts.set("c1", "algo");
    assert.equal((await settle({ channelId: "c1", clear: true })).vaciado, true);
    assert.deepEqual(DraftActions.saveDraft.mock.calls, [["c1", "", 0]]);
    state.drafts.set("c1", "algo");
    DraftActions.saveDraft.mockImplementation(() => { });
    assert.deepEqual(await settle({ channelId: "c1", clear: true }), { ok: false, error: "Discord no vació la caja de ese chat" });
});

const reaction = (chatId, messageId, emoji = "👍") => ({ chatId, messageId, emoji });

test("react: the user's reaction through Discord's action, reported once Discord shows it", async () => {
    loaded("dm1", [message("4")]);
    assert.deepEqual(await settle({ react: reaction("dm1", "4") }), { ok: true, chat: DM, reaccionado: true });
    assert.deepEqual(addReaction.mock.calls, [["dm1", "4", { id: null, name: "👍", animated: false }]]);
    vi.setSystemTime(Date.now() + 10_000);
    addReaction.mockImplementation(async () => { });
    assert.deepEqual(await settle({ react: reaction("dm1", "4", "🎉") }), { ok: false, error: "Discord no confirmó la reacción; revisa el mensaje" });
});

test("react and unreact: each answers as soon as Discord shows the change; a message without reactions yet can get one", async () => {
    loaded("dm1", [message("4", { reactions: undefined }), message("5")]);
    const unconfirmed = await settle({ react: reaction("dm1", "4") });
    assert.deepEqual(unconfirmed, { ok: false, error: "Discord no confirmó la reacción; revisa el mensaje" }, "the fake adds nothing to a list it doesn't have");
    vi.setSystemTime(Date.now() + 10_000);
    const added = await timed({ react: reaction("dm1", "5") });
    assert.equal(added.answer.ok, true);
    assert.ok(added.ms <= 100, `${added.ms} ms`);
    vi.setSystemTime(Date.now() + 10_000);
    const removed = await timed({ unreact: reaction("dm1", "5") });
    assert.equal(removed.answer.ok, true);
    assert.ok(removed.ms <= 100, `${removed.ms} ms`);
});

test("react and unreact: a chat or message Discord doesn't have touches nothing", async () => {
    for (const key of ["react", "unreact"]) {
        assert.deepEqual(await settle({ [key]: reaction("nada", "4") }), { ok: false, error: "No encuentro ese chat" });
        assert.deepEqual(await settle({ [key]: reaction("dm1", "4") }), { ok: false, error: "Ese mensaje no está cargado en ese chat; cárgalo antes con read --fetch" });
    }
    assert.equal(addReaction.mock.calls.length + removeReaction.mock.calls.length, 0);
});

test("unreact: only the user's own reaction with that emoji, through Discord's action, reported once it's gone", async () => {
    loaded("dm1", [message("4", { reactions: [
        { emoji: { id: null, name: "👍" }, me: false }, { emoji: { id: "9", name: "🎉" }, me: true }, { emoji: { id: null, name: "🎉" }, me: true }
    ] })]);
    assert.deepEqual(await settle({ unreact: reaction("dm1", "4") }), { ok: false, error: "El usuario no ha reaccionado con ese emoji a ese mensaje" });
    assert.deepEqual(await settle({ unreact: reaction("dm1", "4", "🎉") }), { ok: true, chat: DM, reaccionQuitada: true });
    assert.deepEqual(removeReaction.mock.calls, [[{ channelId: "dm1", messageId: "4", emoji: { id: null, name: "🎉", animated: false } }]]);
    loaded("dm1", [message("4", { reactions: [{ emoji: { id: null, name: "👍" }, me: true }] })]);
    vi.setSystemTime(Date.now() + 10_000);
    removeReaction.mockImplementation(async () => { });
    assert.deepEqual(await settle({ unreact: reaction("dm1", "4") }), { ok: false, error: "Discord no confirmó que se quitara la reacción; revisa el mensaje" });
});

test("edit: the user's own message gets the new text through Discord's action, reported once Discord shows it", async () => {
    loaded("dm1", [mine("4"), message("5")]);
    const edit = (messageId, text = "nuevo") => settle({ edit: { chatId: "dm1", messageId, text } });
    assert.deepEqual(await settle({ edit: { chatId: "nada", messageId: "4", text: "x" } }), { ok: false, error: "No encuentro ese chat" });
    assert.deepEqual(await edit("9"), { ok: false, error: "Ese mensaje no está cargado en ese chat; cárgalo antes con read --fetch" });
    assert.deepEqual(await edit("5"), { ok: false, error: "Ese mensaje no es del usuario" });
    assert.deepEqual(await edit("4", "hola"), { ok: false, error: "El mensaje ya tiene ese texto" });
    assert.deepEqual(await edit("4"), { ok: true, chat: DM, editado: true });
    assert.deepEqual(MessageActions.editMessage.mock.calls, [["dm1", "4", { content: "nuevo" }]]);
    vi.setSystemTime(Date.now() + 10_000);
    MessageActions.editMessage.mockImplementation(async () => { });
    assert.deepEqual(await edit("4", "otro"), { ok: false, error: "Discord no confirmó la edición; revisa el mensaje" });
});

test("delete: the user's own message goes through Discord's action, reported once it's gone", async () => {
    loaded("dm1", [mine("4"), mine("6"), message("5")]);
    const remove = messageId => settle({ delete: { chatId: "dm1", messageId } });
    assert.deepEqual(await remove("5"), { ok: false, error: "Ese mensaje no es del usuario" });
    assert.deepEqual(await remove("9"), { ok: false, error: "Ese mensaje no está cargado en ese chat; cárgalo antes con read --fetch" });
    assert.deepEqual(await settle({ delete: { chatId: "nada", messageId: "4" } }), { ok: false, error: "No encuentro ese chat" });
    assert.deepEqual(await remove("4"), { ok: true, chat: DM, borrado: true });
    assert.deepEqual(MessageActions.deleteMessage.mock.calls, [["dm1", "4"]]);
    vi.setSystemTime(Date.now() + 10_000);
    MessageActions.deleteMessage.mockImplementation(async () => { });
    assert.deepEqual(await remove("6"), { ok: false, error: "Discord no confirmó el borrado; revisa el chat" });
});

const tooSoon = { ok: false, error: "Límite de ritmo: espera unos segundos entre acciones en el mismo chat" };

test("rate limit: every action that publishes counts, per chat; a refused one publishes nothing", async () => {
    loaded("dm1", [mine("4"), mine("6"), message("5", { reactions: [{ emoji: { id: null, name: "👍" }, me: true }] })]);
    assert.equal((await settle({ edit: { chatId: "dm1", messageId: "4", text: "a" } })).ok, true);
    assert.deepEqual(await settle({ edit: { chatId: "dm1", messageId: "4", text: "b" } }), tooSoon);
    assert.deepEqual(await settle({ delete: { chatId: "dm1", messageId: "6" } }), tooSoon);
    assert.deepEqual(await settle({ react: reaction("dm1", "5", "🎉") }), tooSoon);
    assert.deepEqual(await settle({ unreact: reaction("dm1", "5") }), tooSoon);
    assert.deepEqual(await settle({ sendDirect: "dm1", expect: "hola" }), tooSoon);
    state.selected = "dm1";
    chatBox("hola");
    assert.deepEqual(await settle({ send: "dm1", expect: "hola" }), tooSoon);
    assert.equal(MessageActions.editMessage.mock.calls.length, 1);
    assert.equal(MessageActions.deleteMessage.mock.calls.length + addReaction.mock.calls.length + removeReaction.mock.calls.length, 0);
    assert.equal(MessageActions.sendMessage.mock.calls.length, 0);
});

test("rate limit: each action that publishes holds back the next one in its chat", async () => {
    loaded("dm1", [mine("4"), mine("6"), message("5")]);
    state.selected = "dm1";
    const actions = [
        { react: reaction("dm1", "5") }, { unreact: reaction("dm1", "5") }, { edit: { chatId: "dm1", messageId: "4", text: "otro" } },
        { delete: { chatId: "dm1", messageId: "6" } }, { sendDirect: "dm1", expect: "hola" }
    ];
    for (const action of actions) {
        vi.setSystemTime(Date.now() + 10_000);
        assert.equal((await settle(action)).ok, true, JSON.stringify(action));
        assert.deepEqual(await settle({ sendDirect: "dm1", expect: "x" }), tooSoon, `after ${Object.keys(action)[0]}`);
    }
    vi.setSystemTime(Date.now() + 10_000);
    sendingBox("hola");
    assert.equal((await settle({ send: "dm1", expect: "hola" })).ok, true);
    assert.deepEqual(await settle({ sendDirect: "dm1", expect: "x" }), tooSoon, "after send");
});

test("send --direct: the confirmed text through Discord's send action, without opening the chat", async () => {
    assert.deepEqual(await settle({ sendDirect: "nada", expect: "x" }), { ok: false, error: "No encuentro ese chat" });
    assert.deepEqual(await settle({ sendDirect: "dm1", expect: "  " }), { ok: false, error: "No hay nada que enviar" });
    assert.deepEqual(await settle({ sendDirect: "dm1" }), { ok: false, error: "No hay nada que enviar" });
    assert.deepEqual(await settle({ sendDirect: "dm1", expect: "x", replyTo: "9" }),
        { ok: false, error: "Ese mensaje no está cargado en ese chat; cárgalo antes con read --fetch" });
    assert.deepEqual(await settle({ sendDirect: "dm1", expect: "hola" }), { ok: true, chat: DM, enviado: true, id: "sent" });
    assert.deepEqual(MessageActions.sendMessage.mock.calls, [["dm1", { content: "hola", tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, false, {}]]);
    assert.equal(ChannelRouter.transitionToChannel.mock.calls.length, 0);
});

test("send --direct: a reply goes with Discord's options for it; an unconfirmed or failed send says so", async () => {
    const replied = message("4");
    loaded("dm1", [replied]);
    assert.equal((await settle({ sendDirect: "dm1", expect: "x", replyTo: "4" })).ok, true);
    const [[options]] = MessageActions.getSendMessageOptionsForReply.mock.calls;
    assert.deepEqual({ ...options, channel: options.channel.id }, { channel: "dm1", message: replied, shouldMention: true });
    assert.deepEqual(MessageActions.sendMessage.mock.calls[0][3], { messageReference: { message_id: "4" } });
    vi.setSystemTime(Date.now() + 10_000);
    MessageActions.sendMessage.mockResolvedValueOnce({ body: {} });
    assert.deepEqual(await settle({ sendDirect: "dm1", expect: "x" }), { ok: false, error: "Discord no confirmó el envío; revisa el chat" });
    vi.setSystemTime(Date.now() + 10_000);
    MessageActions.sendMessage.mockResolvedValueOnce({});
    assert.deepEqual(await settle({ sendDirect: "dm1", expect: "x" }), { ok: false, error: "Discord no confirmó el envío; revisa el chat" });
    vi.setSystemTime(Date.now() + 10_000);
    MessageActions.sendMessage.mockResolvedValueOnce(undefined);
    assert.deepEqual(await settle({ sendDirect: "dm1", expect: "x" }), { ok: false, error: "Discord no confirmó el envío; revisa el chat" });
    vi.setSystemTime(Date.now() + 10_000);
    MessageActions.sendMessage.mockRejectedValueOnce(new Error("403"));
    assert.deepEqual(await settle({ sendDirect: "dm1", expect: "x" }), { ok: false, error: "Discord no pudo enviar el mensaje: Error: 403" });
});

/** The open chat's box, whose Enter makes Discord add the message as it would: first SENDING, then `final`. */
function sendingBox(text, final = "SENT", fields = {}) {
    state.selected = "dm1";
    const chat = loaded("dm1", [message("2"), mine("3"), message("4")]);
    const box = chatBox(text);
    box.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        const sent = mine("tmp", { content: text, state: "SENDING", ...fields });
        chat._array = [...chat._array, sent];
        setTimeout(() => Object.assign(sent, { id: "99", state: final }), 500);
    });
    return box;
}

test("send: Enter in the open chat's box sends what it holds, when it is the confirmed text, reported once Discord accepts it", async () => {
    const box = sendingBox("hola");
    const focused = vi.spyOn(box, "focus");
    const { answer, ms } = await timed({ send: "dm1", expect: "hola" });
    assert.deepEqual(answer, { ok: true, chat: DM, enviado: true, id: "99" });
    assert.ok(ms <= 600, `${ms} ms: as soon as Discord accepts it`);
    assert.equal(focused.mock.calls.length, 1);
});

test("send: a send Discord marks as failed, or never confirms, says so", async () => {
    sendingBox("hola", "SEND_FAILED");
    const failed = await timed({ send: "dm1", expect: "hola" });
    assert.deepEqual(failed.answer, { ok: false, error: "Discord no pudo enviar el mensaje" });
    assert.ok(failed.ms <= 600, `${failed.ms} ms: as soon as Discord marks it`);
    reset();
    vi.setSystemTime(Date.now() + 10_000);
    state.users.set(ana.id, ana);
    state.privateChannels.push(channel({ id: "dm1", type: 1, recipients: [ana.id] }));
    sendingBox("hola", "SENDING");
    assert.deepEqual(await settle({ send: "dm1", expect: "hola" }), { ok: false, error: "Discord no confirmó el envío; revisa el chat" });
});

test("send: a message that isn't the user's, or no new one, is not the send", async () => {
    sendingBox("hola", "SENT", { author: ana });
    assert.deepEqual(await settle({ send: "dm1", expect: "hola" }), { ok: false, error: "Discord no confirmó el envío; revisa el chat" });
    vi.setSystemTime(Date.now() + 10_000);
    loaded("dm1", [message("2"), message("3"), mine("4")]);
    chatBox("hola");
    assert.deepEqual(await settle({ send: "dm1", expect: "hola" }), { ok: false, error: "Discord no confirmó el envío; revisa el chat" },
        "the user's last message was there before the Enter");
    vi.setSystemTime(Date.now() + 10_000);
    state.chats.delete("dm1");
    assert.deepEqual(await settle({ send: "dm1", expect: "hola" }), { ok: false, error: "Discord no confirmó el envío; revisa el chat" });
});

test("send: only in the open chat, only the confirmed text, only something, and only with its box on screen", async () => {
    assert.deepEqual(await settle({ send: "nada", expect: "x" }), { ok: false, error: "No encuentro ese chat" });
    assert.deepEqual(await settle({ send: "dm1", expect: "x" }), { ok: false, error: "Ese chat no está abierto en Discord; deja antes el borrador con draft" });
    state.selected = "dm1";
    state.drafts.set("dm1", "otro");
    assert.deepEqual(await settle({ send: "dm1", expect: "x" }), { ok: false, error: "El borrador de la caja no es el texto confirmado; no envío nada" });
    state.drafts.set("dm1", " ");
    assert.deepEqual(await settle({ send: "dm1", expect: " " }), { ok: false, error: "No hay nada que enviar" });
    state.drafts.delete("dm1");
    assert.deepEqual(await settle({ send: "dm1", expect: "" }), { ok: false, error: "No hay nada que enviar" });
    state.uploads.set("dm1", 1);
    assert.deepEqual(await settle({ send: "dm1", expect: "" }), { ok: false, error: "No encuentro la caja de texto del chat" });
    assert.equal(MessageActions.sendMessage.mock.calls.length, 0);
});
