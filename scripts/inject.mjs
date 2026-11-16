// Patches Discord with mod/dist/main.js (`install`) or restores it (`uninstall`). Discord must be closed.
// Discord's app.asar is kept as _app.asar and app.asar becomes a small loader, the same on every system.
import { existsSync, renameSync, statSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

import { asar } from "./asar.mjs";
import { asar as asarPath, discordRunning, original, resources } from "./discord-app.mjs";

const MAIN = fileURLToPath(new URL("../mod/dist/main.js", import.meta.url));
// A loader is a few hundred bytes; Discord's own app.asar is megabytes.
const LOADER_MAX_BYTES = 4096;

/** What the patcher tells the user. */
const TEXT = {
    usage: "Uso: node scripts/inject.mjs install|uninstall",
    running: "Cierra Discord antes.",
    noBuild: "Falta mod/dist/main.js: ejecuta pnpm build.",
    strangeAsar: "Hay _app.asar y un app.asar que no es un cargador; revisa la carpeta resources de Discord a mano.",
    notLoader: "app.asar no es un cargador; revisa la carpeta resources de Discord a mano.",
    notPatched: "Discord no está parcheado.",
    noPermission: dir => `Sin permiso para escribir en ${dir}. En macOS, da a tu terminal el permiso Gestión de las apps.`,
    patched: "Discord parcheado con mod/dist/main.js",
    restored: "Discord restaurado"
};

function fail(message) {
    console.error(message);
    process.exit(1);
}

const isLoader = file => statSync(file).size <= LOADER_MAX_BYTES;

function install(app, kept) {
    if (!existsSync(MAIN)) fail(TEXT.noBuild);
    if (existsSync(kept)) {
        if (!isLoader(app)) fail(TEXT.strangeAsar);
    } else {
        renameSync(app, kept);
    }
    writeFileSync(app, asar({
        "index.js": `require(${JSON.stringify(MAIN)})`,
        "package.json": JSON.stringify({ name: "discord", main: "index.js" })
    }));
    console.log(TEXT.patched);
}

function uninstall(app, kept) {
    if (!existsSync(kept)) fail(TEXT.notPatched);
    if (!isLoader(app)) fail(TEXT.notLoader);
    renameSync(kept, app);
    console.log(TEXT.restored);
}

const command = process.argv[2];
if (command !== "install" && command !== "uninstall") fail(TEXT.usage);
if (discordRunning()) fail(TEXT.running);
try {
    (command === "install" ? install : uninstall)(asarPath(), original());
} catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code !== "EACCES" && code !== "EPERM") throw err;
    fail(TEXT.noPermission(resources()));
}
