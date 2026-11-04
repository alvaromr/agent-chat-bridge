// Read-only checks against the running, patched Discord. Run with `pnpm smoke`.
// Publishes nothing, loads nothing from Discord's API and only prints check names: no chat names or messages.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const CLI = new URL("../scripts/acb.mjs", import.meta.url).pathname;
const SOCKET = join(homedir(), "Library", "Application Support", "agent-chat-bridge", "compose.sock");
const KINDS = ["dm", "grupo", "canal", "hilo"];
// Over the 10 s that mod/src/compose.ts waits for the renderer, so a Discord that hangs fails the check, not blocks it.
const ANSWER_MS = 15_000;

/** Runs the CLI and returns its exit code and parsed JSON, never its raw output (it holds chat names). */
async function cli(...args) {
    const { stdout, code, killed } = await promisify(execFile)("node", [CLI, ...args], { timeout: ANSWER_MS })
        .then(r => ({ ...r, code: 0, killed: false }), e => e);
    assert.ok(!killed, `the CLI didn't answer within ${ANSWER_MS / 1000} s`);
    return { code, result: JSON.parse(stdout) };
}

/** Sends one raw line to the socket and returns the first line of the answer. */
const raw = line => new Promise((resolve, reject) => {
    const conn = connect(SOCKET, () => conn.write(line + "\n"));
    let answer = "";
    conn.setEncoding("utf8");
    conn.setTimeout(ANSWER_MS, () => {
        conn.destroy();
        reject(new Error(`the socket didn't answer within ${ANSWER_MS / 1000} s`));
    });
    conn.on("data", chunk => {
        answer += chunk;
        if (answer.includes("\n")) {
            conn.destroy();
            resolve(JSON.parse(answer.slice(0, answer.indexOf("\n"))));
        }
    });
    conn.on("error", reject);
});

const isCandidate = c => typeof c.id === "string" && KINDS.includes(c.kind) && typeof c.label === "string";

const STARTUP_MS = 30_000;
let first;
// Right after Discord starts, its socket can be missing, or answer before Discord has loaded any chat.
before(async () => {
    const deadline = Date.now() + STARTUP_MS;
    while (!first) {
        const { code, result } = await cli("list").catch(() => ({ code: undefined, result: undefined }));
        first = code === 0 ? result.chats[0] : undefined;
        if (first) break;
        assert.ok(Date.now() < deadline, `Discord has to be open and patched, with its chats loaded, within ${STARTUP_MS / 1000} s`);
        await sleep(1000);
    }
});

test("list returns chats with id, kind and name", async () => {
    const { result } = await cli("list", "--since", "semana");
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.chats) && result.chats.every(isCandidate), "shape of the chats");
});

test("unread returns counts and whether each chat is muted", async () => {
    const { result } = await cli("unread");
    assert.equal(result.ok, true);
    assert.ok(result.sinLeer.every(c => isCandidate(c) && Number.isInteger(c.mensajes)
        && Number.isInteger(c.menciones) && typeof c.silenciado === "boolean"), "shape of the unread chats");
});

test("draft --dry-run resolves the chat without touching it", async () => {
    const { result } = await cli("draft", first.id, "prueba", "--id", "--dry-run");
    assert.equal(result.ok, true);
    assert.equal(result.chat.id, first.id);
    assert.equal(result.borradorCargado, false);
});

test("read returns messages in their shape, or asks for --fetch", async () => {
    const { result } = await cli("read", first.id, "--limit", "5");
    if (!result.ok) return assert.match(result.error, /--fetch/);
    assert.ok(Number.isInteger(result.cargados) && typeof result.rangoCompleto === "boolean", "counts");
    assert.ok(result.mensajes.every(m => typeof m.id === "string" && typeof m.yo === "boolean" && !isNaN(Date.parse(m.fecha))
        && typeof m.texto === "string" && Array.isArray(m.adjuntos) && (m.respondeA === undefined || typeof m.respondeA.id === "string")),
    "shape of the messages");
});

test("send to a chat that doesn't exist sends nothing", async () => {
    const { code, result } = await cli("send", "1", "prueba", "--direct");
    assert.equal(code, 1);
    assert.equal(result.error, "No encuentro ese chat");
});

test("draft --clear --dry-run resolves the chat without emptying it", async () => {
    const { result } = await cli("draft", first.id, "--clear", "--id", "--dry-run");
    assert.equal(result.ok, true);
    assert.equal(result.vaciado, undefined);
});

test("edit, delete and react --remove in a chat that doesn't exist touch nothing", async () => {
    for (const args of [["edit", "1", "2", "prueba"], ["delete", "1", "2"], ["react", "1", "2", "👍", "--remove"]]) {
        const { code, result } = await cli(...args);
        assert.equal(code, 1);
        assert.equal(result.error, "No encuentro ese chat");
    }
});

test("the socket refuses invalid requests", async () => {
    for (const line of ["not json", '{"send":"1","expect":"x","replyTo":"2"}', '{"query":"x","text":"x","files":[]}'])
        assert.deepEqual(await raw(line), { ok: false, error: "Petición no válida" }, "request refused");
});

test("watch confirms which chats it listens to", async () => {
    assert.deepEqual(await raw(JSON.stringify({ watch: [first.id] })), { ok: true, escuchando: [first.id] });
});
