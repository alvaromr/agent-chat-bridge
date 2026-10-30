// Arguments and dates of the CLI (scripts/discord-mod.mjs), without Discord. Run with `pnpm test`.
import assert from "node:assert/strict";

import { expect, test, vi } from "vitest";

import { buildRequest, dateSpan, UsageError } from "../scripts/discord-mod.mjs";

const request = argv => buildRequest(argv).request;
const usage = (argv, message) => assert.throws(() => buildRequest(argv), message ? new UsageError(message) : UsageError, argv.join(" "));
const help = argv => {
    const built = buildRequest(argv);
    assert.ok("help" in built);
    return built.help;
};

test("help: general and per command", () => {
    expect(help([])).toMatchSnapshot();
    assert.equal(help(["--help"]), help([]));
    assert.equal(help(["-h"]), help([]));
    for (const name of ["draft", "send", "edit", "delete", "react", "watch", "list", "unread", "read"]) {
        expect(help([name, "--help"])).toMatchSnapshot(name);
        assert.equal(help([name, "-h"]), help([name, "--help"]));
    }
});

test("commands and their number of arguments", () => {
    usage(["borrar"], `Comando desconocido: borrar\n\n${help([])}`);
    usage(["send", "1"], `Uso: ${help(["send", "--help"]).split("\n")[0]}`);
    usage(["draft", "nacho", "hola", "otro"]);
    usage(["react", "1", "2"]);
    usage(["watch"]);
    usage(["watch", ...Array(11).fill("1")]);
    usage(["read"]);
});

test("draft: text or an attachment, and the chat by name or by id", () => {
    usage(["draft", "nacho"]);
    assert.deepEqual(request(["draft", "nacho", "hola"]), { text: "hola", query: "nacho" });
    assert.deepEqual(request(["draft", "1", "hola", "--id", "--dry-run"]), { text: "hola", channelId: "1", dryRun: true });
    const { attach } = request(["draft", "nacho", "--attach", "a.png", "--attach", "/tmp/b.png"]);
    assert.deepEqual(attach, [`${process.cwd()}/a.png`, "/tmp/b.png"]);
});

test("draft --clear takes no text and no other options", () => {
    usage(["draft", "1", "hola", "--clear"]);
    usage(["draft", "1", "--clear", "--attach", "a.png"]);
    usage(["draft", "1", "--clear", "--replace"]);
    assert.deepEqual(request(["draft", "1", "--clear", "--id"]), { channelId: "1", clear: true });
});

test("send: --reply only with --direct", () => {
    usage(["send", "1", "hola", "--reply", "2"]);
    assert.deepEqual(request(["send", "1", "hola"]), { send: "1", expect: "hola" });
    assert.deepEqual(request(["send", "1", "hola", "--direct", "--reply", "2"]), { send: "1", expect: "hola", direct: true, replyTo: "2" });
});

test("list and unread: known kinds and filters", () => {
    usage(["list", "servidor"]);
    assert.deepEqual(request(["list"]), { list: true });
    assert.deepEqual(request(["list", "canal", "hilo"]), { list: true, kinds: ["canal", "hilo"] });
    assert.deepEqual(request(["unread", "dm", "grupo", "--server", "mtx"]), { unread: true, kinds: ["dm", "grupo"], server: "mtx" });
});

test("read: --limit is a number", () => {
    for (const limit of ["diez", "5x", "x5"]) usage(["read", "1", "--limit", limit], "--limit debe ser un número");
    assert.deepEqual(request(["read", "1", "--limit", "12"]), { read: "1", limit: 12 });
    assert.deepEqual(request(["read", "1", "--limit", "5", "--fetch", "--more", "--unread"]),
        { read: "1", unreadOnly: true, limit: 5, fetch: true, more: true });
});

test("read: --older from 1 to 3, and not with --more", () => {
    const readUsage = help(["read", "--help"]).split("\n")[0];
    for (const older of ["4", "dos", "13"]) usage(["read", "1", "--older", older], `--older debe ser 1, 2 o 3\nUso: ${readUsage}`);
    usage(["read", "1", "--older", "1", "--more"]);
    assert.deepEqual(request(["read", "1", "--older", "2"]), { read: "1", older: 2 });
});

test("edit and delete", () => {
    usage(["edit", "1", "2"]);
    usage(["edit", "1", "2", " "]);
    usage(["delete", "1"]);
    assert.deepEqual(request(["edit", "1", "2", "hola"]), { edit: { chatId: "1", messageId: "2", text: "hola" } });
    assert.deepEqual(request(["delete", "1", "2"]), { delete: { chatId: "1", messageId: "2" } });
});

test("react and watch", () => {
    assert.deepEqual(request(["react", "1", "2", "👍"]), { react: { chatId: "1", messageId: "2", emoji: "👍" } });
    assert.deepEqual(request(["react", "1", "2", "👍", "--remove"]), { react: { chatId: "1", messageId: "2", emoji: "👍", remove: true } });
    assert.deepEqual(request(["watch", "1", "2"]), { watch: ["1", "2"] });
});

/** Runs `check` with the clock at `now`. */
const at = (now, check) => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    try {
        check();
    } finally {
        vi.useRealTimers();
    }
};
const local = (month, day) => new Date(2026, month - 1, day).getTime();

test("named dates, in local time, across the daylight saving change", () => {
    // Monday 26 October 2026, a second before midnight; summer time ended on Sunday the 25th.
    at(new Date(2026, 9, 26, 23, 59, 59), () => {
        assert.deepEqual(dateSpan("hoy"), { start: local(10, 26), end: local(10, 27) });
        assert.deepEqual(dateSpan("ayer"), { start: local(10, 25), end: local(10, 26) });
        assert.deepEqual(dateSpan("semana"), { start: local(10, 26), end: local(10, 27) });
    });
    // Sunday 25 October: the week started on Monday the 19th, still in summer time.
    at(new Date(2026, 9, 25, 12), () => {
        assert.deepEqual(dateSpan("semana"), { start: local(10, 19), end: local(10, 26) });
    });
});

test("exact dates: a bare day spans all of it, a date-time is one instant, and impossible dates are refused", () => {
    assert.deepEqual(dateSpan("2026-10-28"), { start: new Date(2026, 9, 28).getTime(), end: new Date(2026, 9, 29).getTime() });
    const instant = new Date(2026, 9, 28, 9, 30).getTime();
    assert.deepEqual(dateSpan("2026-10-28T09:30"), { start: instant, end: instant });
    for (const bad of ["28-10-2026", "mañana", "2026-13-01", "2026-10-28T25:00", "2026-10-28T09:30:00", "+002026-10-28T09:30"])
        assert.throws(() => dateSpan(bad), new UsageError(`Fecha no válida: ${bad}`));
    assert.deepEqual(request(["read", "1", "--since", "2026-10-28", "--until", "2026-10-28"]),
        { read: "1", since: new Date(2026, 9, 28).getTime(), until: new Date(2026, 9, 29).getTime() });
});
