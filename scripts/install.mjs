// The CLI's own commands, besides its requests to Discord (scripts/agent-chat-bridge.mjs). In the release's executable,
// `install` sets everything up and `uninstall` takes it down; `inject`, `uninject`, `check-discord` and `repatch` are
// the steps a clone runs with pnpm, which the scheduled re-patch calls the executable for. Each command's module loads
// only when it runs.
import { cpSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { INSTALLED, STATE, unpack, UNPACKED, VERSION } from "./bundle.mjs";

/** Where Claude Code finds the skill. */
const SKILL = join(homedir(), ".claude", "skills", "agent-chat-bridge");

/** What the person installing reads. */
const TEXT = {
    fromClone: "En un clon del repo no se usa install ni uninstall: Discord se parchea con pnpm inject, la comprobación "
        + "con pnpm repatch install, y la skill y el comando con pnpm links (AGENTS.md, «Commands»).",
    installed: `agent-chat-bridge ${VERSION} instalado. La skill de Claude Code está en ${SKILL}. Abre Discord para usarlo.`,
    uninstalled: binary => `agent-chat-bridge desinstalado; tus ajustes siguen en ${STATE}. Para terminar, borra ${binary}.`
};

/** Whether this runs as the executable; a clone says how it installs instead. */
function fromExecutable() {
    if (INSTALLED) return true;
    console.error(TEXT.fromClone);
    process.exitCode = 2;
    return false;
}

const inject = async (/** @type {string} */ command) => (await import("./inject.mjs")).patch(command);
const repatch = async (/** @type {string | undefined} */ command) => (await import("./repatch.mjs")).main(command);

/** The files, the skill, the patch and the scheduled check. Discord must be closed, as for the patch. */
async function install() {
    if (!fromExecutable()) return;
    unpack();
    rmSync(SKILL, { recursive: true, force: true });
    cpSync(join(STATE, "skills", "agent-chat-bridge"), SKILL, { recursive: true });
    await inject("install");
    await repatch("install");
    console.log(TEXT.installed);
}

/** The scheduled check, the patch, the skill and the files go; the settings stay, and so does the executable. */
async function uninstall() {
    if (!fromExecutable()) return;
    await repatch("uninstall");
    if (existsSync((await import("./discord-app.mjs")).original())) await inject("uninstall");
    rmSync(SKILL, { recursive: true, force: true });
    for (const dir of UNPACKED) rmSync(join(STATE, dir), { recursive: true, force: true });
    console.log(TEXT.uninstalled(process.execPath));
}

/** The CLI's own commands: what each does, as its help lists it, and what runs it with the arguments after its name. */
export const LOCAL_COMMANDS = {
    install: { summary: "instala el parche de Discord, la skill de Claude Code y la comprobación tras cada actualización (con Discord cerrado)", run: install },
    uninstall: { summary: "quita todo eso; tus ajustes se quedan", run: uninstall },
    inject: { summary: "vuelve a parchear Discord (con Discord cerrado)", run: () => inject("install") },
    uninject: { summary: "quita el parche de Discord", run: () => inject("uninstall") },
    "check-discord": {
        summary: "comprueba que el parche encaja con el código del Discord que se abrió por última vez",
        run: async () => {
            await import("./check-discord/code.mjs");
            await import("./check-discord/css.mjs");
        }
    },
    repatch: { summary: "la comprobación programada: install, uninstall, run o apply", run: (/** @type {string[]} */ [command]) => repatch(command) }
};
