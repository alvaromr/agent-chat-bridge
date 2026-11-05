// The worker protocol of dictation/README.md («Worker»): requests as bytes for its stdin, answers from its stdout.
// Pure.

export type Answer = { ready: true; } | { text: string; };

/** A JSON header line, then the samples as little-endian 32-bit floats. */
export function encodeRequest(samples: Float32Array, prompt: string | null): Uint8Array {
    const header = new TextEncoder().encode(`${JSON.stringify({ samples: samples.length, prompt })}\n`);
    const out = new Uint8Array(header.length + samples.length * 4);
    out.set(header);
    const view = new DataView(out.buffer, header.length);
    for (const [i, x] of samples.entries()) view.setFloat32(i * 4, x, true);
    return out;
}

/** Parses one stdout line; throws on anything the protocol doesn't define. */
export function parseAnswer(line: string): Answer {
    const answer = JSON.parse(line);
    if (answer?.ready === true) return { ready: true };
    if (typeof answer?.text === "string") return { text: answer.text };
    throw new Error("the worker answered outside the protocol");
}

/** Splits a text stream into lines, keeping an unfinished one for the next chunk. */
export function lineSplitter() {
    let rest = "";
    return (chunk: string): string[] => {
        const text = rest + chunk, end = text.lastIndexOf("\n");
        rest = text.slice(end + 1);
        return end < 0 ? [] : text.slice(0, end).split("\n");
    };
}
