// Message text as `read` and `watch` return it, without Discord: read.ts looks the names up in its stores.
import type { ComposeMessage } from "../ipc";

/** What Discord calls the users, roles and channels a message mentions; undefined when it doesn't know them. */
export interface Names {
    user(id: string): string | undefined;
    role(id: string): string | undefined;
    channel(id: string): string | undefined;
}

const MAX_EMBED_TEXT = 1000;

/** `<@id>`, `<@&id>`, `<#id>` and `<t:seconds:style>` as Discord shows them (dates in ISO, UTC). */
export const readableMentions = (text: string, names: Names) => text
    .replace(/<t:(\d+)(?::\w)?>/g, (raw, seconds) => {
        const date = new Date(Number(seconds) * 1000);
        return isNaN(date.getTime()) ? raw : date.toISOString();
    })
    .replace(/<@!?(\d+)>/g, (raw, id) => names.user(id) ? `@${names.user(id)}` : raw)
    .replace(/<@&(\d+)>/g, (raw, id) => names.role(id) ? `@${names.role(id)}` : raw)
    .replace(/<#(\d+)>/g, (raw, id) => names.channel(id) ? `#${names.channel(id)}` : raw);

/** Unicode emojis as themselves, custom ones as :name:; `mia` when the user reacted with it. */
export const reaction = (r: any) => ({
    emoji: r.emoji.id ? `:${r.emoji.name}:` : r.emoji.name,
    total: r.count,
    mia: !!(r.me || r.me_burst)
});

type Embed = NonNullable<ComposeMessage["embeds"]>[number];

/** What bots put in embeds instead of the message text: author, title, description and fields; empty ones left out. */
export function embedTexts(embeds: any[], names: Names): Embed[] {
    return embeds.flatMap(e => {
        const text = (s: string | undefined) => s ? readableMentions(s, names).slice(0, MAX_EMBED_TEXT) : undefined;
        const autor: string | undefined = e.author?.name;
        const titulo = text(e.rawTitle ?? e.title);
        const descripcion = text(e.rawDescription ?? e.description);
        const campos: string[] = (e.fields ?? []).map((f: any) => `${f.rawName ?? f.name}: ${text(f.rawValue ?? f.value)}`);
        if (!titulo && !descripcion && !campos.length) return [];
        return [{ ...(autor !== undefined ? { autor } : {}), ...(titulo ? { titulo } : {}), ...(descripcion ? { descripcion } : {}), campos }];
    });
}
