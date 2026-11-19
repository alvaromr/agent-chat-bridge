// Dictation's engine: its worker's packages, installed with uv (dictation/README.md, «Install») where they can run.
// Elsewhere, or without uv, it says why and leaves Dictation off, so the rest still installs; the plugin then shows no
// button. Run as `pnpm bootstrap`'s step, a failure of the install itself fails `pnpm bootstrap`; the executable's
// `install --dictation` runs it with the uv it carries (scripts/install.mjs).
import { spawnSync } from "node:child_process";
import { arch, platform, release } from "node:os";

import { canRunWorker } from "../dictation/src/platform.ts";

/** What the person installing reads. */
const TEXT = {
    unsupported: "Dictado: no se instala, porque necesita un Mac con Apple Silicon y macOS 14 o posterior. El resto de agent-chat-bridge sí.",
    noUv: "Dictado: no se instala, porque falta uv (https://docs.astral.sh/uv/). Instálalo y repite `pnpm bootstrap`. El resto de agent-chat-bridge sí."
};

/**
 * Installs the worker's packages into `project`'s .venv, as its uv.lock pins them, with its `dev` group, the gate's
 * Ruff and ty, only for a clone. Returns uv's exit code, 1 when a signal ended it, and 0 where it installs nothing.
 */
export function setUpDictation(uv = "uv", project = "dictation/worker", dev = true) {
    if (!canRunWorker(platform(), arch(), release())) {
        console.warn(TEXT.unsupported);
        return 0;
    }
    if (spawnSync(uv, ["--version"]).error) {
        console.warn(TEXT.noUv);
        return 0;
    }
    return spawnSync(uv, ["sync", "--frozen", ...dev ? [] : ["--no-dev"], "--project", project], { stdio: "inherit" }).status ?? 1;
}

// Stryker disable next-line all: only `pnpm bootstrap` runs it as a command, never the tests (and, for that, not the coverage).
/* v8 ignore next */ if (import.meta.main) process.exitCode = setUpDictation();
