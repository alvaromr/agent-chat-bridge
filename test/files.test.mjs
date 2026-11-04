// Files the main process reads or writes: attachments (mod/src/attachments.ts) and settings (mod/src/settingsFile.ts).
// Run with `pnpm test`. Works in a temporary directory that it deletes at the end.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, test, vi } from "vitest";

import { readAttachments } from "../mod/src/attachments.ts";
import { settingsFile } from "../mod/src/settingsFile.ts";

const dir = mkdtempSync(join(tmpdir(), "discord-mod-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = (name, data = "x") => {
    const path = join(dir, name);
    writeFileSync(path, data);
    return path;
};

test("attachments: name, type by extension and content", () => {
    const files = readAttachments([file("Foto.PNG", "png"), file("notas.md")]);
    assert.ok(Array.isArray(files));
    assert.deepEqual(files.map(f => ({ ...f, data: f.data.toString() })), [
        { name: "Foto.PNG", type: "image/png", data: "png" },
        { name: "notas.md", type: "application/octet-stream", data: "x" }
    ]);
});

test.each([
    ["a.png", "image/png"], ["a.jpg", "image/jpeg"], ["a.jpeg", "image/jpeg"], ["a.gif", "image/gif"],
    ["a.webp", "image/webp"], ["a.mp4", "video/mp4"], ["a.mov", "video/quicktime"], ["a.pdf", "application/pdf"],
    ["a.txt", "text/plain"]
])("attachments: %s is sent as %s", (name, type) => {
    const files = readAttachments([file(name)]);
    assert.ok(Array.isArray(files));
    assert.equal(files[0]?.type, type);
});

test("attachments: no folders, no missing paths and nothing over 25 MB", () => {
    mkdirSync(join(dir, "carpeta"));
    assert.equal(readAttachments([join(dir, "carpeta")]), `No es un fichero: ${join(dir, "carpeta")}`);
    assert.equal(readAttachments([join(dir, "no-existe.png")]), `No existe: ${join(dir, "no-existe.png")}`);
    const big = file("grande.mp4", "");
    truncateSync(big, 25 * 1024 * 1024); // sparse: takes no space on disk
    assert.equal(readAttachments([big]).length, 1, "exactly 25 MB is allowed");
    truncateSync(big, 25 * 1024 * 1024 + 1);
    assert.equal(readAttachments([file("bien.png"), big]), `Pasa de 25 MB: ${big}`);
});

test("attachments: a path that exists but can't be read says why", () => {
    const closed = join(dir, "cerrada");
    mkdirSync(closed, { mode: 0o000 });
    try {
        assert.equal(readAttachments([join(closed, "foto.png")]), `No se puede leer (EACCES): ${join(closed, "foto.png")}`);
    } finally {
        chmodSync(closed, 0o700);
    }
});

test("attachments: a file that can be found but not read says why instead of failing the request", () => {
    const locked = file("bloqueada.png");
    chmodSync(locked, 0o000);
    try {
        assert.equal(readAttachments([locked]), `No se puede leer (EACCES): ${locked}`);
    } finally {
        chmodSync(locked, 0o600);
    }
});

test("settings: saved to a 0600 file in a 0700 folder, leaving no temporary file", () => {
    const path = join(dir, "ajustes", "settings.json");
    settingsFile(path).write({ corrector: { model: "x" } });
    assert.deepEqual(settingsFile(path).read(), { settings: { corrector: { model: "x" } } });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, "ajustes")).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(join(dir, "ajustes")), ["settings.json"]);
});

/** Settings whose saved JSON is exactly `bytes` long. */
const sized = bytes => ({ a: "x".repeat(bytes - JSON.stringify({ a: "" }, null, 4).length) });

test("settings: only a plain object of 256 KB at most, and the previous file stays intact", () => {
    const path = join(dir, "intactos.json");
    const settings = settingsFile(path);
    settings.write(sized(256 * 1024));
    assert.equal(statSync(path).size, 256 * 1024);
    settings.write({ a: 1 });
    const before = readFileSync(path, "utf8");
    for (const bad of [null, undefined, 1, "x", [1], sized(256 * 1024 + 1)])
        assert.throws(() => settings.write(bad), /Ajustes no válidos/, JSON.stringify(bad)?.slice(0, 20));
    assert.equal(readFileSync(path, "utf8"), before);
});

test("settings: without a file they read as empty, silently", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    assert.deepEqual(settingsFile(join(dir, "no-existe.json")).read(), { settings: {} });
    assert.equal(error.mock.calls.length, 0);
});

const NOW = new Date("2026-10-30T10:00:00Z");
const parseError = text => {
    try {
        JSON.parse(text);
    } catch (err) {
        return err instanceof Error ? err.message : "";
    }
    return "";
};

test.each([
    ["broken JSON", "{", parseError("{")],
    ["an array", "[1]", "no es un objeto JSON"],
    ["null", "null", "no es un objeto JSON"],
    ["a string", "\"x\"", "no es un objeto JSON"]
])("settings: %s reads as empty, moves aside for the user to see, and a save no longer touches it", (_, text, reason) => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const folder = mkdtempSync(join(dir, "ilegibles-"));
    const path = join(folder, "settings.json");
    writeFileSync(path, text);
    const copy = `${path}.unreadable-${NOW.getTime()}`;
    const settings = settingsFile(path);
    try {
        assert.deepEqual(settings.read(), {
            settings: {},
            problem: `No se pudieron leer los ajustes (${reason}), así que se usan los de por defecto. El fichero queda en ${copy}`
        });
        assert.deepEqual(error.mock.calls, [[`[agent-chat-bridge] Unreadable settings, using the defaults: ${path}: ${reason}; moved to ${copy}`]]);
        settings.write({ a: 1 });
        assert.equal(readFileSync(copy, "utf8"), text);
        assert.deepEqual(settings.read(), { settings: { a: 1 } });
    } finally {
        vi.useRealTimers();
    }
});

test("settings: a file that can't be read or moved blocks saving, so nothing overwrites it", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const folder = mkdtempSync(join(dir, "cerrada-"));
    const path = join(folder, "settings.json");
    writeFileSync(path, "{");
    chmodSync(folder, 0o500);
    const settings = settingsFile(path);
    try {
        assert.deepEqual(settings.read(), {
            settings: {},
            problem: `No se pudieron leer los ajustes (${parseError("{")}), así que se usan los de por defecto. Tampoco se pudo apartar el fichero, así que los cambios no se guardarán hasta que lo arregles o lo borres: ${path}`
        });
        assert.equal(error.mock.calls.length, 1);
        assert.match(String(error.mock.calls[0]?.[0]), new RegExp(`^\\[agent-chat-bridge\\] Unreadable settings, using the defaults: ${path}: .+; not moved: EACCES: `));
        chmodSync(folder, 0o700);
        assert.throws(() => settings.write({ a: 1 }), new Error(`Los ajustes guardados no se pudieron leer; arregla o borra ${path}`));
        assert.equal(readFileSync(path, "utf8"), "{");
    } finally {
        chmodSync(folder, 0o700);
        vi.useRealTimers();
    }
});

test("settings: a folder in the file's place is unreadable too, and moves aside", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const path = join(mkdtempSync(join(dir, "carpeta-")), "settings.json");
    mkdirSync(path);
    try {
        const copy = `${path}.unreadable-${NOW.getTime()}`;
        const { problem = "" } = settingsFile(path).read();
        assert.match(problem, /^No se pudieron leer los ajustes \(EISDIR: [^)]+\), así que se usan los de por defecto\. El fichero queda en /);
        assert.ok(problem.endsWith(copy));
        assert.ok(statSync(copy).isDirectory());
    } finally {
        vi.useRealTimers();
    }
});
