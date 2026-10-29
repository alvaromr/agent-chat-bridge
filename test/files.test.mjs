// Files the main process reads or writes: attachments (mod/src/attachments.ts) and settings (mod/src/settingsFile.ts).
// Run with `pnpm test`. Works in a temporary directory that it deletes at the end.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, test, vi } from "vitest";

import { readAttachments } from "../mod/src/attachments.ts";
import { readSettings, writeSettings } from "../mod/src/settingsFile.ts";

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

test("settings: saved to a 0600 file in a 0700 folder, leaving no temporary file", () => {
    const settings = join(dir, "ajustes", "settings.json");
    writeSettings(settings, { corrector: { model: "x" } });
    assert.deepEqual(readSettings(settings), { corrector: { model: "x" } });
    assert.equal(statSync(settings).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, "ajustes")).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(join(dir, "ajustes")), ["settings.json"]);
});

/** Settings whose saved JSON is exactly `bytes` long. */
const sized = bytes => ({ a: "x".repeat(bytes - JSON.stringify({ a: "" }, null, 4).length) });

test("settings: only a plain object of 256 KB at most, and the previous file stays intact", () => {
    const settings = join(dir, "intactos.json");
    writeSettings(settings, sized(256 * 1024));
    assert.equal(statSync(settings).size, 256 * 1024);
    writeSettings(settings, { a: 1 });
    const before = readFileSync(settings, "utf8");
    for (const bad of [null, undefined, 1, "x", [1], sized(256 * 1024 + 1)])
        assert.throws(() => writeSettings(settings, bad), /Ajustes no válidos/, JSON.stringify(bad)?.slice(0, 20));
    assert.equal(readFileSync(settings, "utf8"), before);
});

test("settings: without a file they read as empty, silently", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    assert.deepEqual(readSettings(join(dir, "no-existe.json")), {});
    assert.equal(error.mock.calls.length, 0);
});

test("settings: broken JSON reads as empty and is logged with the file", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = file("roto.json", "{");
    assert.deepEqual(readSettings(broken), {});
    const [call] = error.mock.calls;
    assert.ok(call);
    assert.match(call.join(" "), new RegExp(`^\\[discord-mod\\] Unreadable settings, using the defaults: ${broken}: `));
});
