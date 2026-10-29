// The asar archive that scripts/inject.mjs writes as Discord's app.asar. No I/O, so test/ loads it directly.

/**
 * Minimal asar archive: a pickled JSON header that lists the files, followed by their bytes.
 * @param {Record<string, string>} files
 */
export function asar(files) {
    /** @type {{ files: Record<string, { size: number, offset: string }> }} */
    const header = { files: {} };
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        header.files[name] = { size: Buffer.byteLength(content), offset: String(offset) };
        offset += Buffer.byteLength(content);
    }
    const json = Buffer.from(JSON.stringify(header));
    const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4);
    json.copy(padded);

    const sizes = Buffer.alloc(16);
    sizes.writeUInt32LE(4, 0);
    sizes.writeUInt32LE(padded.length + 8, 4);
    sizes.writeUInt32LE(padded.length + 4, 8);
    sizes.writeUInt32LE(json.length, 12);
    return Buffer.concat([sizes, padded, ...Object.values(files).map(content => Buffer.from(content))]);
}
