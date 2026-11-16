// Where the patch lives in the installed Discord, the same on every system once its resources folder is found
// (scripts/os/): shared by the patcher (scripts/inject.mjs), the re-patch after an update (scripts/repatch.mjs) and
// `pnpm check-discord`.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { system } from "./os/index.mjs";

/** Why there is no Discord to patch. */
const TEXT = {
    notFound: "No encuentro Discord instalado. Si acabas de instalarlo, ábrelo una vez: en Windows y Linux se instala al "
        + "arrancar. En Linux, Flatpak y Snap no son compatibles: instala el .deb o el .tar.gz."
};

/** Discord's resources folder, or an error when no Discord is installed where this system keeps it. */
export function resources() {
    const dir = system.resources();
    if (!dir) throw new Error(TEXT.notFound);
    return dir;
}

export const asar = () => join(resources(), "app.asar");
/** Discord's own app.asar, kept aside while patched: its absence means Discord is not patched. */
export const original = () => join(resources(), "_app.asar");
/** The installed Discord's version, from the build_info.json it ships on every system. */
export const discordVersion = () => JSON.parse(readFileSync(join(resources(), "build_info.json"), "utf8")).version;
export const discordRunning = () => system.running();
