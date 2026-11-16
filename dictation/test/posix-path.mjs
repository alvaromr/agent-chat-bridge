// For a test file that fakes a POSIX machine (macOS or Linux) on whatever system the suite runs on, Windows included
// (.github/workflows/ci.yml): Node's path module as POSIX joins paths, so the faked machine's paths keep their `/`.
// Here, inside dictation/, so its tests use it without importing from outside; test/ uses it too. Each such file mocks
// both names the code imports the module by (from test/, the path starts with ../dictation/test/):
//     vi.mock("node:path", async original => (await import("./posix-path.mjs")).posixPath(original));
//     vi.mock("path", async original => (await import("./posix-path.mjs")).posixPath(original));

/** The factory of the mock: the POSIX side of the real module, as its named exports and its default one. */
export async function posixPath(/** @type {() => Promise<unknown>} */ original) {
    const { posix } = /** @type {typeof import("node:path")} */ (await original());
    return { ...posix, default: posix };
}
