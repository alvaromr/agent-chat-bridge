// The worker protocol (dictation/src/protocol.ts): what goes to its stdin and what comes from its stdout.
import assert from "node:assert/strict";

import { test } from "vitest";

import { encodeRequest, lineSplitter, parseAnswer } from "../src/protocol.ts";

test("protocol: a request is a JSON header line, then the samples as little-endian 32-bit floats", () => {
    const bytes = encodeRequest(Float32Array.of(0.5, -1), "Hablamos de git.");
    const header = '{"samples":2,"prompt":"Hablamos de git."}\n';
    assert.equal(new TextDecoder().decode(bytes.subarray(0, header.length)), header);
    assert.deepEqual([...bytes.subarray(header.length)], [0, 0, 0, 63, 0, 0, 128, 191]);
    assert.equal(new TextDecoder().decode(encodeRequest(new Float32Array(0), null)), '{"samples":0,"prompt":null}\n');
});

test("protocol: answers are «ready» or a text; anything else is an error that doesn't show the line", () => {
    assert.deepEqual(parseAnswer('{"ready": true}'), { ready: true });
    assert.deepEqual(parseAnswer('{"text": "hola", "extra": 1}'), { text: "hola" });
    for (const line of ['{"ready": 1}', '{"text": 3}', "null", "[]"]) assert.throws(() => parseAnswer(line), { message: "the worker answered outside the protocol" });
    assert.throws(() => parseAnswer("secreto"), SyntaxError);
});

test("protocol: lines split across chunks come out whole, and an unfinished one waits", () => {
    const split = lineSplitter();
    assert.deepEqual(split('{"rea'), []);
    assert.deepEqual(split('dy": true}\n{"text": "a"}\n{"te'), ['{"ready": true}', '{"text": "a"}']);
    assert.deepEqual(split('xt": "b"}\n'), ['{"text": "b"}']);
    // An empty line is a line too: parseAnswer() then refuses it.
    assert.deepEqual(split("\n"), [""]);
});
