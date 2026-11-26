// Patches Discord with mod/dist/main.js (`install`) or restores it (`uninstall`). Discord must be closed.
// Discord's app.asar is kept as _app.asar and app.asar becomes a small loader, the same on every system. The loader
// requires mod/dist/main.js where scripts/bundle.mjs says the files are: the clone, or the app's folder.
import { existsSync, renameSync, statSync, writeFileSync } from "fs";

import { asar } from "./asar.mjs";
import { INSTALLED, modMain } from "./bundle.mjs";
import { asar as asarPath, discordRunning, original, patchBlocked, resources } from "./discord-app.mjs";

// A loader is a few hundred bytes; Discord's own app.asar is megabytes.
const LOADER_MAX_BYTES = 4096;

/** What the patcher tells the user. */
const TEXT = {
    usage: INSTALLED ? "Uso: agent-chat-bridge inject|uninject" : "Uso: node scripts/inject.mjs install|uninstall",
    running: "Cierra Discord antes.",
    noBuild: INSTALLED ? "Falta el parche: ejecuta agent-chat-bridge install." : "Falta mod/dist/main.js: ejecuta pnpm build.",
    strangeAsar: "Hay _app.asar y un app.asar que no es un cargador; revisa la carpeta resources de Discord a mano.",
    notLoader: "app.asar no es un cargador; revisa la carpeta resources de Discord a mano.",
    notPatched: "Discord no está parcheado.",
    noPermission: dir => `Sin permiso para escribir en ${dir}. En macOS, da a tu terminal el permiso Gestión de las apps.`,
    patched: main => `Discord parcheado con ${main}`,
    restored: "Discord restaurado"
};

function fail(message) {
    console.error(message);
    process.exit(1);
}

const isLoader = file => statSync(file).size <= LOADER_MAX_BYTES;

function install(app, kept) {
    const main = modMain();
    if (!existsSync(main)) fail(TEXT.noBuild);
    if (existsSync(kept)) {
        if (!isLoader(app)) fail(TEXT.strangeAsar);
    } else {
        renameSync(app, kept);
    }
    writeFileSync(app, asar({
        "index.js": `require(${JSON.stringify(main)})`,
        "package.json": JSON.stringify({ name: "discord", main: "index.js" })
    }));
    console.log(TEXT.patched(main));
}

function uninstall(app, kept) {
    if (!existsSync(kept)) fail(TEXT.notPatched);
    if (!isLoader(app)) fail(TEXT.notLoader);
    renameSync(kept, app);
    console.log(TEXT.restored);
}

/** Patches Discord (`install`) or restores it (`uninstall`); any other command prints the usage. */
export function patch(command) {
    if (command !== "install" && command !== "uninstall") fail(TEXT.usage);
    // Before the check of a running Discord: seeing it run from the app to patch is what lets the next try patch it.
    const blocked = command === "install" && patchBlocked();
    if (blocked) fail(blocked);
    if (discordRunning()) fail(TEXT.running);
    try {
        (command === "install" ? install : uninstall)(asarPath(), original());
    } catch (err) {
        const code = /** @type {NodeJS.ErrnoException} */ (err).code;
        if (code !== "EACCES" && code !== "EPERM") throw err;
        fail(TEXT.noPermission(resources()));
    }
}

if (import.meta.main) patch(process.argv[2]);
