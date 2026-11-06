// `pnpm setup`'s step for Dictation: installs its worker's packages with uv (dictation/README.md, «Install») where
// they can run. Elsewhere, or without uv, it says why and leaves Dictation off, so the rest still installs; the
// plugin then shows no button. A failure of the install itself fails `pnpm setup`.
import { spawnSync } from "node:child_process";
import { arch, platform, release } from "node:os";

import { canRunWorker } from "../dictation/src/platform.ts";

/** What the person installing reads. */
const TEXT = {
    unsupported: "Dictado: no se instala, porque necesita un Mac con Apple Silicon y macOS 14 o posterior. El resto de agent-chat-bridge sí.",
    noUv: "Dictado: no se instala, porque falta uv (https://docs.astral.sh/uv/). Instálalo y repite `pnpm setup`. El resto de agent-chat-bridge sí."
};

if (!canRunWorker(platform(), arch(), release())) console.warn(TEXT.unsupported);
else if (spawnSync("uv", ["--version"]).error) console.warn(TEXT.noUv);
else process.exitCode = spawnSync("uv", ["sync", "--frozen", "--project", "dictation/worker"], { stdio: "inherit" }).status ?? 1;
