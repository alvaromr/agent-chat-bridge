// Message text as read and watch return it (mod/src/renderer/format.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { embedTexts, reaction, readableMentions } from "../mod/src/renderer/format.ts";

// Discord ids are snowflakes of 17 to 20 digits.
const USER = "80351110224678912";
const ROLE = "80351110224678913";
const CHANNEL = "80351110224678914";
const names = {
    user: id => ({ [USER]: "Nacho" })[id],
    role: id => ({ [ROLE]: "admins" })[id],
    channel: id => ({ [CHANNEL]: "general" })[id]
};

test("known mentions by their name; unknown ones as they are", () => {
    assert.equal(readableMentions(`<@${USER}> <@!${USER}> <@&${ROLE}> <#${CHANNEL}>`, names), "@Nacho @Nacho @admins #general");
    assert.equal(readableMentions("<@99> <@&99> <#99>", names), "<@99> <@&99> <#99>");
});

test("<t:…> dates in ISO UTC, with or without a style", () => {
    assert.equal(readableMentions("<t:0> <t:1761650000:R>", names), "1970-01-01T00:00:00.000Z 2025-10-28T11:13:20.000Z");
});

test("an out-of-range <t:…> date stays as it is instead of breaking the message", () => {
    assert.equal(readableMentions("<t:99999999999999999>", names), "<t:99999999999999999>");
});

test("reactions: Unicode as is, custom ones as :name:, and whether it is mine", () => {
    assert.deepEqual(reaction({ emoji: { id: null, name: "👍" }, count: 2, me: true }), { emoji: "👍", total: 2, mia: true });
    assert.deepEqual(reaction({ emoji: { id: "5", name: "gato" }, count: 1, me: false, me_burst: true }), { emoji: ":gato:", total: 1, mia: true });
    assert.deepEqual(reaction({ emoji: { id: null, name: "🎉" }, count: 1 }), { emoji: "🎉", total: 1, mia: false });
});

test("embeds: the raw text when there is one, empty parts left out and no empty embeds", () => {
    const [embed, ...rest] = embedTexts([
        { author: { name: "Bot" }, rawTitle: `Aviso <@${USER}>`, title: "Aviso @Nacho", fields: [{ rawName: "Canal", rawValue: `<#${CHANNEL}>` }] },
        { author: { name: "Solo autor" } },
        { title: "x".repeat(1500) }
    ], names);
    assert.deepEqual(embed, { autor: "Bot", titulo: "Aviso @Nacho", campos: ["Canal: #general"] });
    assert.equal(rest.length, 1, "the embed without text is left out");
    assert.equal(rest[0]?.titulo?.length, 1000);
});

test("embeds: fields without a raw version use their name and value", () => {
    assert.deepEqual(embedTexts([{ fields: [{ name: "Estado", value: `<@${USER}> listo` }] }], names), [{ campos: ["Estado: @Nacho listo"] }]);
});

test("embeds: a description alone is enough, the raw one when there is one", () => {
    assert.deepEqual(embedTexts([{ rawDescription: `<#${CHANNEL}>`, description: "#general" }, { description: "hola" }], names),
        [{ descripcion: "#general", campos: [] }, { descripcion: "hola", campos: [] }]);
});
