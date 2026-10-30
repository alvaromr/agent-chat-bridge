// What the Autorespuesta gives Claude. Each text goes in as JSON with "<" escaped, so a message can neither close its
// block nor pass for a line of another author: other people's messages stay data.
import type { Message, User } from "@plugin-api/discordTypes";

/** The parts of a user and of a message that the input reads. */
type Person = Pick<User, "id" | "username" | "globalName">;
type ChatMessage = Pick<Message, "content"> & { author: Person; attachments: readonly unknown[]; };

const displayName = (user: Person) => user.globalName ?? user.username;
const encode = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** One JSON line per message, ending with an empty one of mine for the model to fill. */
function transcript(messages: ChatMessage[], me: Person) {
    const line = (author: Person, text: string, attachments: number) =>
        encode({ autor: displayName(author), yo: author.id === me.id, texto: text, ...attachments && { adjuntos: attachments } });
    return [
        ...messages.filter(m => m.content || m.attachments.length).map(m => line(m.author, m.content, m.attachments.length)),
        line(me, "", 0)
    ].join("\n");
}

/** The conversation from the chosen message, my earlier messages as examples of tone, and the draft as a guide. */
export function buildInput({ conversation, me, examples, guide }: { conversation: ChatMessage[]; me: Person; examples: string[]; guide: string; }) {
    return [
        ...examples.length ? [`<ejemplos>\n${examples.map(encode).join("\n")}\n</ejemplos>`] : [],
        `<conversación>\n${transcript(conversation, me)}\n</conversación>`,
        ...guide.trim() ? [`<guía>\n${encode(guide)}\n</guía>`] : []
    ].join("\n\n");
}
