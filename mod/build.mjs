// Builds mod/dist/{main,preload,renderer}.js.
import { build } from "esbuild";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";

const path = file => fileURLToPath(new URL(file, import.meta.url));

/** Plugin styles and the base styles, as text. @type {import("esbuild").Plugin} */
const cssAsText = {
    name: "css-as-text",
    setup(build) {
        build.onResolve({ filter: /\.css$/ }, args => ({
            path: fileURLToPath(new URL(args.path, `file://${args.resolveDir}/`)),
            namespace: "css-text"
        }));
        build.onLoad({ filter: /.*/, namespace: "css-text" }, async args => ({ contents: await readFile(args.path, "utf8"), loader: "text" }));
    }
};

/** @type {import("esbuild").BuildOptions} */
const common = {
    bundle: true,
    target: "esnext",
    tsconfig: path("tsconfig.json"),
    logLevel: "info",
    legalComments: "none"
};
/** @type {import("esbuild").BuildOptions} */
const node = { ...common, platform: "node", format: "cjs", external: ["electron"] };

await Promise.all([
    build({ ...node, entryPoints: [path("src/main.ts")], outfile: path("dist/main.js") }),
    build({ ...node, entryPoints: [path("src/preload.ts")], outfile: path("dist/preload.js") }),
    build({
        ...common,
        entryPoints: [path("src/renderer/index.ts")],
        outfile: path("dist/renderer.js"),
        platform: "browser",
        format: "iife",
        jsx: "transform",
        jsxFactory: "AgentChatBridgeCreateElement",
        jsxFragment: "AgentChatBridgeFragment",
        inject: [path("src/plugin-api/jsx.ts")],
        plugins: [cssAsText],
        footer: { js: "//# sourceURL=file:///AgentChatBridgeRenderer" }
    })
]);
