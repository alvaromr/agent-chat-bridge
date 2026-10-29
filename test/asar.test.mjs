// The loader archive (scripts/asar.mjs), read back the way Electron reads an asar. Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { asar } from "../scripts/asar.mjs";

/** Electron's reading: a pickle with the header size, then a pickle with the JSON header, then the files' bytes. */
function read(archive) {
    assert.equal(archive.readUInt32LE(0), 4, "size of the first pickle's payload");
    const headerSize = archive.readUInt32LE(4);
    assert.equal(archive.readUInt32LE(8), headerSize - 4, "size of the second pickle's payload");
    const jsonLength = archive.readUInt32LE(12);
    assert.equal((headerSize - 8) % 4, 0, "the JSON is padded to 4 bytes");
    assert.ok(jsonLength <= headerSize - 8 && jsonLength > headerSize - 12, "the padding is under 4 bytes");
    assert.ok(archive.subarray(16 + jsonLength, 8 + headerSize).every(byte => byte === 0), "the padding is zeros");
    const { files } = JSON.parse(archive.subarray(16, 16 + jsonLength).toString());
    const base = 8 + headerSize;
    const contents = Object.fromEntries(Object.entries(files).map(([name, { size, offset }]) =>
        [name, archive.subarray(base + Number(offset), base + Number(offset) + size).toString()]));
    const end = Math.max(base, ...Object.values(files).map(({ size, offset }) => base + Number(offset) + size));
    assert.equal(archive.length, end, "nothing after the last file");
    return { files, contents };
}

test("the files come back with their content, sizes and offsets in bytes", () => {
    const files = { "index.js": 'require("/ruta/ñ/main.js")', "package.json": '{"name":"discord","main":"index.js"}' };
    const { files: header, contents } = read(asar(files));
    assert.deepEqual(contents, files);
    assert.deepEqual(header["index.js"], { size: 27, offset: "0" });
    assert.deepEqual(header["package.json"], { size: 36, offset: "27" });
});

// Names of 1 to 4 characters give JSON headers of every length modulo 4.
test.each(["a", "ab", "abc", "abcd"])("the header of a file named %s is padded to 4 bytes", name => {
    assert.deepEqual(read(asar({ [name]: "x" })).contents, { [name]: "x" });
});

test("an archive with no files holds only the header", () => {
    assert.deepEqual(read(asar({})).contents, {});
});
