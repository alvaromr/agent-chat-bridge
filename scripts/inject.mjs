// Patches Discord with mod/dist/main.js (`install`) or restores it (`uninstall`). Discord must be closed.
// Discord's app.asar is kept as _app.asar and app.asar becomes a small loader.
import { execFileSync } from "child_process";
import { existsSync, renameSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

import { asar } from "./asar.mjs";

const RESOURCES = "/Applications/Discord.app/Contents/Resources";
const ASAR = join(RESOURCES, "app.asar");
const ORIGINAL = join(RESOURCES, "_app.asar");
const MAIN = fileURLToPath(new URL("../mod/dist/main.js", import.meta.url));
// A loader is a few hundred bytes; Discord's own app.asar is megabytes.
const LOADER_MAX_BYTES = 4096;

/** What the patcher tells the user. */
const TEXT = {
    usage: "Uso: node scripts/inject.mjs install|uninstall",
    running: "Cierra Discord antes.",
    noBuild: "Falta mod/dist/main.js: ejecuta pnpm build.",
    strangeAsar: "Hay _app.asar y un app.asar que no es un cargador; revisa Resources a mano.",
    notLoader: "app.asar no es un cargador; revisa Resources a mano.",
    notPatched: "Discord no está parcheado.",
    patched: "Discord parcheado con mod/dist/main.js",
    restored: "Discord restaurado"
};

function fail(message) {
    console.error(message);
    process.exit(1);
}

function discordRunning() {
    try {
        execFileSync("pgrep", ["-x", "Discord"], { stdio: "ignore" });
        return true;
    } catch (err) {
        if (err instanceof Error && "status" in err && err.status === 1) return false; // pgrep found no such process
        throw err;
    }
}

const isLoader = file => statSync(file).size <= LOADER_MAX_BYTES;

const command = process.argv[2];
if (command !== "install" && command !== "uninstall") fail(TEXT.usage);
if (discordRunning()) fail(TEXT.running);

if (command === "install") {
    if (!existsSync(MAIN)) fail(TEXT.noBuild);
    if (existsSync(ORIGINAL)) {
        if (!isLoader(ASAR)) fail(TEXT.strangeAsar);
    } else {
        renameSync(ASAR, ORIGINAL);
    }
    writeFileSync(ASAR, asar({
        "index.js": `require(${JSON.stringify(MAIN)})`,
        "package.json": JSON.stringify({ name: "discord", main: "index.js" })
    }));
    console.log(TEXT.patched);
} else {
    if (!existsSync(ORIGINAL)) fail(TEXT.notPatched);
    if (!isLoader(ASAR)) fail(TEXT.notLoader);
    renameSync(ORIGINAL, ASAR);
    console.log(TEXT.restored);
}
