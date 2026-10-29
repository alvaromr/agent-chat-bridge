import type { Message, User } from "@plugin-api/discordTypes";

/** The parts of a user and of a message that the transcript reads. */
type Person = Pick<User, "id" | "username" | "globalName">;
type ChatMessage = Pick<Message, "content"> & { author: Person; attachments: readonly unknown[]; };

export const displayName = (user: Person) => user.globalName ?? user.username;

/** One line per message, ending with an empty line of mine for the model to fill. */
export function buildTranscript(messages: ChatMessage[], me: Person) {
    const lines = messages
        .filter(m => m.content || m.attachments.length)
        .map(m => {
            const who = `${m.author.id === me.id ? "(yo) " : ""}${displayName(m.author)}`;
            const attachments = m.attachments.length ? " [adjunto]" : "";
            return `${who}: ${m.content}${attachments}`;
        });
    return [...lines, `(yo) ${displayName(me)}:`].join("\n");
}
