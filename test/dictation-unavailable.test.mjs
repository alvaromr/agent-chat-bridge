// @vitest-environment happy-dom
// The Dictation plugin (plugins/dictation/index.tsx) where it can't dictate: the main process offers no model, because
// the worker isn't installed (an Intel Mac, macOS before 14, no uv) or no model is on disk. Its own file, since the
// plugin reads that once, when it starts. Run with `pnpm test`.
import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { keydown, render } from "./dom.mjs";
import { chatBox } from "./fake-discord.mjs";
import { native } from "./fake-native.mjs";

vi.mock("../mod/src/plugin-api/discord.ts", () => import("./fake-discord.mjs"));

const React = await import("react");
const { default: dictation } = await import("../plugins/dictation/index.tsx");

test("dictation: without a model it can run, it shows no button and holding Space types spaces", () => {
    native.dictation.models.mockReturnValue([]);
    dictation.settings.pluginName = dictation.name;
    dictation.start?.();
    const { container } = render(React.createElement(/** @type {any} */ (dictation.chatBarButton?.render), { isMainChat: true, channel: { id: "1" } }));
    assert.equal(container.innerHTML, "");
    const box = chatBox("");
    const prevented = Array.from({ length: 8 }, (_, i) => keydown(box, " ", { code: "Space", repeat: i > 0 }).defaultPrevented);
    assert.deepEqual(prevented, Array(8).fill(false));
    assert.equal(native.dictation.onEvent.mock.calls.length, 0);
    assert.equal(native.dictation.start.mock.calls.length, 0);
    assert.equal(dictation.notice?.(), "Dictado no disponible: necesita su motor, que `pnpm setup` instala en un Mac con Apple Silicon y macOS 14 o posterior, y un modelo descargado (`dictation/worker/.venv/bin/hf download mlx-community/whisper-large-v3-turbo`). Después, reinicia Discord.",
        "its settings tab says why, and how to fix it");
});
