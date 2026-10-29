#!/usr/bin/env node
// discord-mod: talks to the patched Discord through its local socket (mod/src/compose.ts).
// Run with --help for the commands; `pnpm links` puts it on the PATH.
import { connect } from "net";
import { homedir } from "os";
import { join, resolve } from "path";
import { parseArgs } from "util";

const KINDS = ["dm", "grupo", "canal", "hilo"];

const DATE_HELP = `Fechas (--since, --until): hoy, ayer, semana (desde el lunes), AAAA-MM-DD o AAAA-MM-DDTHH:MM, en hora local.
  --until con un día lo incluye entero.`;

const FILTER_HELP = `  --server <nombre>   solo canales e hilos de servidores cuyo nombre contenga <nombre>
Las fechas filtran por el último mensaje del chat.`;
const FILTER_OPTIONS = { server: { type: "string" }, since: { type: "string" }, until: { type: "string" } };
const filters = (kinds, o) => ({ ...(kinds.length ? { kinds } : {}), ...(o.server ? { server: o.server } : {}), ...range(o) });

const COMMANDS = {
    draft: {
        summary: "deja un mensaje listo para enviar en un chat y lo abre",
        usage: "discord-mod draft <chat> [<texto>] [--id] [--reply <id>] [--attach <ruta>]... [--replace] [--background] [--dry-run]\n       discord-mod draft <chat> --clear [--id]",
        help: `Busca el chat por nombre (DM, grupo, canal o hilo), deja <texto> en su caja de texto, lo abre y pone
Discord al frente. No envía nada: para eso está send.
Solo abre un chat si el nombre encaja claramente; si no, devuelve en "candidatos" todos los que encajan.

  --id             <chat> es el id de un chat (de "candidatos", list o unread), no un nombre
  --reply <id>     lo deja como respuesta a ese mensaje (id de read), como el botón Responder de Discord;
                   el mensaje tiene que estar cargado (read --fetch). "respondiendo": true si quedó así.
  --attach <ruta>  adjunta un archivo o imagen (hasta 10, de 25 MB como mucho); repítelo para varios.
                   Con adjuntos el texto es opcional. "adjuntos" dice cuántos hay en la caja.
  --replace        sustituye el borrador o los adjuntos que ya tuviera ese chat (sin esto, se niega)
  --background     no pone Discord al frente (el chat sí cambia dentro de Discord); para la respuesta automática
  --dry-run        solo dice qué chat usaría, sin tocar nada
  --clear          vacía el texto de la caja de ese chat, sin abrirlo ni tocar adjuntos o respuesta.
                   Borra el borrador del usuario: pídele permiso antes. "vaciado": true si quedó vacía.`,
        options: {
            id: { type: "boolean" }, reply: { type: "string" }, attach: { type: "string", multiple: true },
            replace: { type: "boolean" }, background: { type: "boolean" }, "dry-run": { type: "boolean" },
            clear: { type: "boolean" }
        },
        positionals: [1, 2],
        validate: ([, text], o) => o.clear
            ? text === undefined && !o.attach && !o.reply && !o.replace && !o.background ? null : "--clear no lleva texto ni otras opciones"
            : text !== undefined || o.attach?.length ? null : "Falta el texto (o un --attach)",
        request: ([chat, text], o) => ({
            text, ...(o.id ? { channelId: chat } : { query: chat }), replyTo: o.reply,
            attach: o.attach?.map(p => resolve(p)), replace: o.replace, background: o.background, dryRun: o["dry-run"],
            clear: o.clear
        })
    },
    send: {
        summary: "envía un mensaje confirmado por el usuario: el borrador de la caja o, con --direct, sin abrir el chat",
        usage: "discord-mod send <id> <texto confirmado> [--direct [--reply <id>]]",
        help: `Sin --direct: envía lo que hay en la caja del chat <id> (con su respuesta y adjuntos), pulsando Enter como lo
haría el usuario. Solo si el chat está abierto y el texto de la caja es exactamente <texto confirmado>; si no, no
envía nada. Si solo hay adjuntos, <texto confirmado> es "".

  --direct        envía <texto confirmado> sin abrir el chat ni tocar su caja, con la acción de envío de Discord.
                  Solo texto, sin adjuntos. Es lo que usa la respuesta automática.
  --reply <id>    con --direct, lo envía como respuesta a ese mensaje (tiene que estar cargado: read --fetch)

Úsalo solo con confirmación explícita del usuario de ese mensaje (chat, texto, respuesta y adjuntos), salvo en la
respuesta automática que él haya activado. Devuelve "enviado": true y el id del mensaje. Comparte con edit, delete
y react un límite de ritmo: 5 s entre acciones en el mismo chat y 30 por hora.`,
        options: { direct: { type: "boolean" }, reply: { type: "string" } },
        positionals: 2,
        validate: (_, o) => o.reply && !o.direct ? "--reply solo funciona con --direct; sin él, usa draft --reply" : null,
        request: ([id, text], o) => ({ send: id, expect: text, direct: o.direct, replyTo: o.reply })
    },
    edit: {
        summary: "cambia el texto de un mensaje del usuario, solo con su confirmación",
        usage: "discord-mod edit <id del chat> <id del mensaje> <texto confirmado>",
        help: `Sustituye el texto de un mensaje del usuario por <texto confirmado>, con la misma acción que usa Discord al
editar. Se publica al momento y la otra persona ve "(editado)": úsalo solo tras enseñarle al usuario el mensaje
(cítalo) y el texto nuevo, y con su confirmación explícita, también en la respuesta automática. Solo mensajes del
usuario y cargados (read --fetch). Devuelve "editado": true si Discord lo confirma. Comparte el límite de ritmo de send.`,
        options: {},
        positionals: 3,
        validate: ([, , text]) => text.trim() ? null : "Falta el texto nuevo",
        request: ([chatId, messageId, text]) => ({ edit: { chatId, messageId, text } })
    },
    delete: {
        summary: "borra un mensaje del usuario para todos, solo con su confirmación",
        usage: "discord-mod delete <id del chat> <id del mensaje>",
        help: `Borra un mensaje del usuario para todos, con la misma acción que usa Discord al borrar. No se puede deshacer:
úsalo solo tras citarle al usuario el mensaje y con su confirmación explícita, también en la respuesta automática.
Solo mensajes del usuario y cargados (read --fetch). Devuelve "borrado": true si Discord lo confirma. Comparte el
límite de ritmo de send.`,
        options: {},
        positionals: 2,
        request: ([chatId, messageId]) => ({ delete: { chatId, messageId } })
    },
    react: {
        summary: "reacciona a un mensaje con un emoji, solo con confirmación del usuario",
        usage: "discord-mod react <id del chat> <id del mensaje> <emoji> [--remove]",
        help: `Añade la reacción del usuario a un mensaje con un emoji Unicode (por ejemplo 👍), con la misma acción que
usa Discord al reaccionar. Se publica al momento: úsalo solo tras decirle al usuario a qué mensaje y con qué emoji,
y con su confirmación explícita. El mensaje tiene que estar cargado (read --fetch). Los emojis propios de un
servidor no están soportados. Devuelve "reaccionado": true si Discord lo confirma.

  --remove   quita la reacción del usuario con ese emoji, también con su confirmación; "reaccionQuitada": true

Comparte el límite de ritmo de send.`,
        options: { remove: { type: "boolean" } },
        positionals: 3,
        request: ([chatId, messageId, emoji], o) => ({ react: { chatId, messageId, emoji, remove: o.remove } })
    },
    watch: {
        summary: "escucha los mensajes nuevos, editados y borrados de unos chats, en tiempo real",
        usage: "discord-mod watch <id> [<id>...]",
        help: `Mantiene la conexión abierta y escribe una línea JSON por cada cambio en esos chats (hasta 10), incluidos
los mensajes del usuario ("yo": true). Los mensajes tienen el mismo formato que read:
  {"evento":"mensaje","chat":{…},"mensaje":{…}}   mensaje nuevo
  {"evento":"editado","chat":{…},"mensaje":{…}}   mensaje editado, con su texto nuevo
  {"evento":"borrado","chat":{…},"id":"…"}         mensaje borrado
La primera línea confirma qué chats escucha. Termina al cerrar Discord o con Ctrl+C.
Para contestar automáticamente, sigue las reglas de «Auto-reply» de la skill discord-mod.`,
        options: {},
        positionals: [1, 10],
        request: ids => ({ watch: ids })
    },
    list: {
        summary: "lista los chats, del más reciente al más antiguo",
        usage: "discord-mod list [dm|grupo|canal|hilo ...] [--server <nombre>] [--since <fecha>] [--until <fecha>]",
        help: `Lista id, tipo y nombre de los chats de los tipos dados (todos si no se dan).
${FILTER_HELP}

${DATE_HELP}`,
        options: FILTER_OPTIONS,
        positionals: "kinds",
        request: (kinds, o) => ({ list: true, ...filters(kinds, o) })
    },
    unread: {
        summary: "lista los chats con mensajes sin leer, silenciados incluidos",
        usage: "discord-mod unread [dm|grupo|canal|hilo ...] [--server <nombre>] [--since <fecha>] [--until <fecha>]",
        help: `Lista los chats con mensajes sin leer de los tipos dados (todos si no se dan) y sus recuentos, sin
contenido. Los silenciados llevan "silenciado": true. En canales de servidor los recuentos suelen salir a 0: lee el
chat (read --unread) para ver cuáles son.
${FILTER_HELP}

${DATE_HELP}`,
        options: FILTER_OPTIONS,
        positionals: "kinds",
        request: (kinds, o) => ({ unread: true, ...filters(kinds, o) })
    },
    read: {
        summary: "devuelve los últimos mensajes de un chat",
        usage: "discord-mod read <id> [--unread] [--limit <n>] [--fetch] [--more | --older <n>] [--since <fecha>] [--until <fecha>]",
        help: `Devuelve de los últimos mensajes de un chat:
  id (para draft --reply), autor, fecha, "editado" (fecha de la última edición, si la hay),
  "respondeA" (id del mensaje al que responde, con su autor y un extracto si está cargado),
  texto (menciones como @nombre, @rol o #canal; fechas <t:…> en ISO, UTC),
  adjuntos (nombre, tipo y url, que se puede descargar para verlo),
  embeds (autor, título, descripción y campos; ahí escriben los bots),
  reacciones (emoji, total y "mia" si el usuario ha reaccionado con él),
  "sinLeer" y "meMencionan" (al usuario, a todos o a un rol suyo).

  --unread      solo los mensajes sin leer
  --limit <n>   cuántos, de 1 a 100 (por defecto 20, o 100 con --unread, --older o fechas)
  --fetch       si Discord no tiene cargado el chat, lo carga con la misma petición que hace al abrirlo,
                sin abrirlo ni marcarlo como leído. Sin esto solo sirven los chats ya cargados.
  --more        carga páginas anteriores, como al subir con el scroll, hasta el primer mensaje sin leer
                y 3 páginas como mucho ("paginasExtra" dice cuántas)
  --older <n>   para el contexto: carga n páginas anteriores (de 1 a 3), aunque estén leídas, como al subir
                con el scroll. Repetido, sigue desde la más antigua cargada.

"cargados" y "sinLeerCargados" cuentan los mensajes que Discord tiene del chat, antes de --limit y filtros.
"hayMasAntiguos": true si quedan mensajes anteriores sin cargar (prueba --older).
Sin --more ni --older solo hay la página que carga Discord al abrir el chat (unos 10 mensajes):
  "masSinLeerSinCargar": true   hay más mensajes sin leer de los que se ven (prueba --more)
  "rangoCompleto": false        el rango de fechas puede ir más atrás de lo cargado

${DATE_HELP}`,
        options: {
            unread: { type: "boolean" }, limit: { type: "string" }, fetch: { type: "boolean" }, more: { type: "boolean" },
            older: { type: "string" }, since: { type: "string" }, until: { type: "string" }
        },
        positionals: 1,
        validate: (_, o) => {
            if (o.older === undefined) return null;
            if (o.more) return "--more y --older no van juntos";
            return /^[1-3]$/.test(o.older) ? null : "--older debe ser 1, 2 o 3";
        },
        request: ([id], o) => ({
            read: id, unreadOnly: o.unread, ...(o.limit ? { limit: Number(o.limit) } : {}), fetch: o.fetch, more: o.more,
            ...(o.older ? { older: Number(o.older) } : {}), ...range(o)
        })
    }
};

const MAIN_HELP = `discord-mod: usa el Discord parcheado desde la terminal.
Solo send, edit, delete y react publican algo, y solo con confirmación explícita del usuario.

Comandos:
${Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(7)} ${c.summary}`).join("\n")}

Ayuda de cada uno: discord-mod <comando> --help
Responde en JSON; sale con 1 si "ok" es false y con 2 si los argumentos no son válidos.`;

export class UsageError extends Error { }

/** Start of the given local day/week, or an exact local date-time; `end` moves a whole day to its end. */
export function parseDate(value, end) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = (d, offset) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
    const named = { hoy: today, ayer: day(today, -1), semana: day(today, -((today.getDay() + 6) % 7)) };
    if (value in named) return (end ? day(value === "semana" ? today : named[value], 1) : named[value]).getTime();

    // A date-time without an offset is local time; a bare date would be UTC, so it gets midnight added.
    const m = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.exec(value);
    const date = new Date(m?.[1] ? value : `${value}T00:00`);
    if (!m || isNaN(date.getTime())) throw new UsageError(`Fecha no válida: ${value}`);
    if (!m[1] && end) date.setDate(date.getDate() + 1);
    return date.getTime();
}

function range(o) {
    return {
        ...(o.since ? { since: parseDate(o.since, false) } : {}),
        ...(o.until ? { until: parseDate(o.until, true) } : {})
    };
}

export function buildRequest(argv) {
    const [name, ...rest] = argv;
    if (!name || name === "--help" || name === "-h") return { help: MAIN_HELP };
    const command = COMMANDS[name];
    if (!command) throw new UsageError(`Comando desconocido: ${name}\n\n${MAIN_HELP}`);

    const parsed = parseArgs({
        args: rest, allowPositionals: true, options: { ...command.options, help: { type: "boolean", short: "h" } }
    });
    const { positionals } = parsed;
    // parseArgs can't infer the value types from options picked at run time; these are the types its options allow.
    const values = /** @type {Record<string, string | boolean | string[] | undefined>} */ (parsed.values);
    if (values.help) return { help: `${command.usage}\n\n${command.help}` };

    const [min, max] = Array.isArray(command.positionals) ? command.positionals : [command.positionals, command.positionals];
    const bad = command.positionals === "kinds"
        ? positionals.some(k => !KINDS.includes(k))
        : positionals.length < min || positionals.length > max;
    if (bad) throw new UsageError(`Uso: ${command.usage}`);
    const invalid = command.validate?.(positionals, values);
    if (invalid) throw new UsageError(`${invalid}\nUso: ${command.usage}`);
    if (typeof values.limit === "string" && !/^\d+$/.test(values.limit)) throw new UsageError("--limit debe ser un número");
    return { request: JSON.parse(JSON.stringify(command.request(positionals, values))) }; // drops undefined flags
}

// The socket side needs the running Discord: test/smoke.mjs covers it end to end, so unit coverage and mutation skip
// it.
/* v8 ignore start */
// Stryker disable all
const SOCKET = join(homedir(), "Library", "Application Support", "discord-mod", "compose.sock");

function main() {
    let built;
    try {
        built = buildRequest(process.argv.slice(2));
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(2);
    }
    if (built.help) {
        console.log(built.help);
        process.exit(0);
    }

    const conn = connect(SOCKET, () => conn.write(JSON.stringify(built.request) + "\n"));
    let answer = "";
    conn.setEncoding("utf8");
    if (built.request.watch) {
        // A stream: one compact JSON line per event, printed as it arrives.
        conn.on("data", chunk => {
            answer += chunk;
            for (let i; (i = answer.indexOf("\n")) >= 0; answer = answer.slice(i + 1)) console.log(answer.slice(0, i));
        });
        conn.on("end", () => process.exit(0));
    } else {
        conn.on("data", chunk => answer += chunk);
        conn.on("end", () => {
            const result = JSON.parse(answer);
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.ok ? 0 : 1);
        });
    }
    conn.on("error", (/** @type {NodeJS.ErrnoException} */ err) => {
        console.error(err.code === "ENOENT" || err.code === "ECONNREFUSED"
            ? "Discord no está abierto con el parche (falta el socket)"
            : err.message);
        process.exit(1);
    });
}

// Run as the CLI, not when test/ imports it.
if (import.meta.main) main();
// Stryker restore all
/* v8 ignore stop */
