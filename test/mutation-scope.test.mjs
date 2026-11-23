// Which mutants a change since the last `pnpm mutation` re-tests (scripts/mutation-scope.mjs). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import {
    assumedPrevious, changedInputs, configFingerprint, CONFIGS, importsOf, inputGraph, inputValue, packageFingerprint, resolveImport,
    TIMEOUT_INPUT, timeoutFlips, tsconfigChain, withoutStale
} from "../scripts/mutation-scope.mjs";

// Split, so that vitest doesn't find it in this file and run it in that environment.
const ENVIRONMENT = "@vitest-environment";
/** A small project: two test files, a shared helper, the setup file, and code with every kind of import. */
const FILES = {
    "test/a.test.mjs": 'import { a } from "../src/a.ts";\nimport { helper } from "./helper.mjs";\nimport assert from "node:assert";',
    "test/b.test.mjs": `// ${ENVIRONMENT} happy-dom\nimport { b } from "@lib/b";`,
    "test/helper.mjs": "export const helper = 1;",
    "test/setup.mjs": 'import "node:net";',
    "src/a.ts": 'import React from "react";\nimport chart from "chart.js";\nimport { c } from "./dir";\nimport { v } from "./view.tsx.mjs";\n' +
        'export const a = await import("./lazy.mjs");',
    "src/b.tsx": 'import style from "./style.css";\nimport notes from "./notes.js.txt";\nimport { thing } from "@scope/pkg/sub";\nexport const b = <i />;',
    "src/dir/index.ts": "export const c = 1;",
    "src/lazy.mjs": "export default 1;",
    // Names with a code extension before their own: only the last one tells what a file is.
    "src/view.tsx.mjs": "export const v = 1;",
    "src/notes.js.txt": 'import "./missing";',
    "src/n.mts": "export const n = 1;",
    "src/plain.js": "export const p = 1;",
    "src/jsx.ts": "export const h = 1;",
    "src/style.css": "i { color: red; }",
    "tsconfig.json": '{\n    // The repo\'s.\n    "extends": "./base/tsconfig.json"\n}',
    "base/tsconfig.json": "{}"
};
/** @param {string} file */
const read = file => FILES[/** @type {keyof typeof FILES} */ (file)];
const ALIASES = [{ find: /^@lib\//, replacement: "src/" }];
const graph = () => inputGraph({
    tests: ["test/a.test.mjs", "test/b.test.mjs"],
    mutated: ["src/a.ts", "src/b.tsx"],
    setupFiles: ["test/setup.mjs"],
    aliases: ALIASES,
    jsxInject: 'import { h } from "@lib/jsx";',
    tsconfig: "tsconfig.json",
    typePackages: ["@types/node"],
    read
});
const EVERY_TEST = ["file:test/setup.mjs", "package:vitest", "package:@stryker-mutator/core", "package:@stryker-mutator/vitest-runner",
    "config:vitest", "config:stryker"];
/** What src/a.ts and src/b.tsx reach, themselves included. */
const A_IMPORTS = ["file:src/a.ts", "package:react", "package:chart.js", "file:src/dir/index.ts", "file:src/view.tsx.mjs", "file:src/lazy.mjs"];
const B_IMPORTS = ["file:src/b.tsx", "file:src/style.css", "file:src/notes.js.txt", "package:@scope/pkg", "file:src/jsx.ts"];
const EVERY_CHECK = ["package:typescript", "package:@stryker-mutator/typescript-checker", "package:@types/node",
    "file:tsconfig.json", "file:base/tsconfig.json", "config:stryker"];

test("imports: every static, re-exported, required and dynamic specifier, and the test environment unless it is Node's", () => {
    const source = 'import a from "a";\nexport { b } from "./b";\nconst c = require("c");\nawait import("./d.mjs");\nimport type { E } from "e";';
    assert.deepEqual(importsOf(source), ["a", "./b", "c", "./d.mjs", "e"]);
    assert.deepEqual(importsOf(`/** ${ENVIRONMENT} happy-dom */\nimport a from "a";`), ["a", "happy-dom"]);
    assert.deepEqual(importsOf(`// ${ENVIRONMENT.replace("vitest", "jest")}   jsdom\n`), ["jsdom"]);
    assert.deepEqual(importsOf(`// ${ENVIRONMENT} node\n`), []);
});

test("imports resolve as vitest resolves them: alias, relative path, added extension, folder index; bare ones are packages", () => {
    /** @type {[string, string, string | undefined][]} */
    const cases = [
        ["test/a.test.mjs", "../src/a.ts", "file:src/a.ts"],
        ["test/b.test.mjs", "@lib/b", "file:src/b.tsx"],
        ["src/a.ts", "./lazy", "file:src/lazy.mjs"],
        ["src/a.ts", "./n", "file:src/n.mts"],
        ["src/a.ts", "./plain", "file:src/plain.js"],
        ["src/a.ts", "./dir", "file:src/dir/index.ts"],
        ["src/b.tsx", "./style.css", "file:src/style.css"],
        ["src/a.ts", "react", "package:react"],
        ["src/a.ts", "react/jsx-runtime", "package:react"],
        ["src/b.tsx", "@scope/pkg/sub", "package:@scope/pkg"],
        ["src/b.tsx", "@scope/pkg", "package:@scope/pkg"],
        ["test/a.test.mjs", "node:assert", undefined],
        ["test/a.test.mjs", "fs", undefined]
    ];
    for (const [from, specifier, input] of cases) assert.equal(resolveImport(from, specifier, ALIASES, read), input, specifier);
});

test("an import that matches no file fails loudly, so that no change goes unseen", () => {
    assert.throws(() => resolveImport("src/a.ts", "./missing", ALIASES, read), { message: "Cannot resolve ./missing from src/a.ts" });
});

test("tsconfig: the file and the ones it extends, with comments allowed", () => {
    assert.deepEqual(tsconfigChain("tsconfig.json", read), ["tsconfig.json", "base/tsconfig.json"]);
});

test("a test file reaches itself, what it imports through every hop, the JSX inject, packages, its environment, and what runs every test", () => {
    const { tests } = graph();
    assert.deepEqual([...tests.keys()], ["test/a.test.mjs", "test/b.test.mjs"]);
    assert.deepEqual([...(tests.get("test/a.test.mjs") ?? [])].sort(), [...EVERY_TEST, "file:test/a.test.mjs", "file:test/helper.mjs",
        ...A_IMPORTS].sort());
    assert.deepEqual([...(tests.get("test/b.test.mjs") ?? [])].sort(), [...EVERY_TEST, "file:test/b.test.mjs", "package:happy-dom",
        ...B_IMPORTS].sort());
});

test("each file's imports are read once, however many test files reach it", () => {
    /** @type {string[]} */
    const reads = [];
    inputGraph({ tests: ["test/a.test.mjs", "test/b.test.mjs"], mutated: ["src/a.ts"], setupFiles: ["test/setup.mjs"], aliases: ALIASES,
        jsxInject: "", tsconfig: "base/tsconfig.json", typePackages: [], read: file => (reads.push(file), read(file)) });
    assert.deepEqual(reads.filter(file => file === "test/setup.mjs"), ["test/setup.mjs"]);
});

test("a mutated file's type-check reaches what it imports, the checker, the type packages, the tsconfig chain and Stryker's config", () => {
    const { compile } = graph();
    assert.deepEqual([...(compile.get("src/a.ts") ?? [])].sort(), [...EVERY_CHECK, ...A_IMPORTS].sort());
    assert.deepEqual([...(compile.get("src/b.tsx") ?? [])].sort(), [...EVERY_CHECK, ...B_IMPORTS].sort());
});

/** Mutants of every status, covered by test t1 in a.test, t2 in b.test, or t3 that the report doesn't place. */
const REPORT = {
    schemaVersion: "2",
    files: {
        "src/a.ts": {
            source: "…",
            mutants: [
                { id: "killed-by-a", status: "Killed", killedBy: ["t1"], coveredBy: ["t1", "t2"] },
                { id: "killed-by-b", status: "Killed", killedBy: ["t2"], coveredBy: ["t1", "t2"] },
                { id: "killed-static-by-b", status: "Killed", static: true, killedBy: ["t2"], coveredBy: [] },
                { id: "killed-by-none", status: "Killed", coveredBy: ["t2"] },
                { id: "survived-a", status: "Survived", coveredBy: ["t1"] },
                { id: "survived-b", status: "Survived", coveredBy: ["t2"] },
                { id: "survived-static", status: "Survived", static: true, coveredBy: ["t2"] },
                { id: "survived-unplaced", status: "Survived", coveredBy: ["t2", "t3"] },
                { id: "no-coverage", status: "NoCoverage" },
                { id: "timeout-a", status: "Timeout", killedBy: ["t1"] },
                { id: "compile", status: "CompileError" },
                { id: "ignored", status: "Ignored" }
            ]
        },
        "src/b.tsx": { source: "…", mutants: [{ id: "compile-b", status: "CompileError" }, { id: "survived-b2", status: "Survived", coveredBy: ["t2"] }] }
    },
    testFiles: { "test/a.test.mjs": { tests: [{ id: "t1" }] }, "test/b.test.mjs": { tests: [{ id: "t2" }] } }
};
/**
 * The ids of the mutants left in each file, after a change in `changed` and one of the timeout that flips `flipped`.
 * @param {string[]} changed @param {string[]} [flipped]
 */
const kept = (changed, flipped = []) => {
    const { report, retested } = withoutStale(REPORT, graph(), new Set(changed), new Set(flipped));
    return { retested, ...Object.fromEntries(Object.entries(report.files).map(([file, { mutants }]) => [file, mutants.map(({ id }) => id)])) };
};
const ALL_A = REPORT.files["src/a.ts"].mutants.map(({ id }) => id);

test("nothing changed: every result is kept, and the rest of the report with them", () => {
    const { report, retested } = withoutStale(REPORT, graph(), new Set(), new Set());
    assert.equal(retested, 0);
    assert.deepEqual(report, REPORT);
});

test("a shared helper re-tests only the mutants whose tests use it, the static ones and those no test is known for", () => {
    assert.deepEqual(kept(["file:test/helper.mjs"]), {
        retested: 7,
        "src/a.ts": ["killed-by-b", "killed-static-by-b", "survived-b", "compile", "ignored"],
        "src/b.tsx": ["compile-b", "survived-b2"]
    });
});

test("code a mutant's tests run re-tests it, and the compile errors of the files that import that code", () => {
    assert.deepEqual(kept(["file:src/dir/index.ts"]), {
        retested: 8,
        "src/a.ts": ["killed-by-b", "killed-static-by-b", "survived-b", "ignored"],
        "src/b.tsx": ["compile-b", "survived-b2"]
    });
});

test("a dependency re-tests only the mutants whose tests import it, and the compile errors of the code that does", () => {
    const testsOnly = { retested: 8, "src/a.ts": ["killed-by-a", "survived-a", "timeout-a", "compile", "ignored"], "src/b.tsx": ["compile-b"] };
    assert.deepEqual(kept(["package:happy-dom"]), testsOnly);
    assert.deepEqual(kept(["package:@scope/pkg"]), { ...testsOnly, retested: 9, "src/b.tsx": [] });
});

test("the type-checker re-tests the compile errors and nothing else", () => {
    for (const input of ["package:typescript", "package:@types/node", "file:base/tsconfig.json"]) {
        assert.deepEqual(kept([input]), { retested: 2, "src/a.ts": ALL_A.filter(id => id !== "compile"), "src/b.tsx": ["survived-b2"] }, input);
    }
});

test("what runs every test re-tests every mutant but the ignored ones", () => {
    for (const input of ["package:vitest", "config:vitest", "file:test/setup.mjs"]) {
        assert.deepEqual(kept([input]), { retested: 11, "src/a.ts": ["compile", "ignored"], "src/b.tsx": ["compile-b"] }, input);
    }
    assert.deepEqual(kept(["config:stryker"]), { retested: 13, "src/a.ts": ["ignored"], "src/b.tsx": [] });
});

test("a report without its tests' files attributes no test, so any affected test re-tests every covered mutant", () => {
    const { report, retested } = withoutStale({ files: REPORT.files }, graph(), new Set(["file:test/helper.mjs"]), new Set());
    assert.equal(retested, 11);
    assert.deepEqual(report.files["src/a.ts"]?.mutants.map(({ id }) => id), ["compile", "ignored"]);
});

test("a compile error in a file no longer mutated keeps its result, which Stryker drops itself", () => {
    const report = { files: { "src/gone.ts": { mutants: [{ id: "compile", status: "CompileError" }] } } };
    assert.deepEqual(withoutStale(report, graph(), new Set(["package:typescript"]), new Set()), { report, retested: 0 });
});

test("a change of the timeout re-tests only the mutants of the statuses it flips, whatever their tests reach", () => {
    assert.deepEqual(kept([TIMEOUT_INPUT], ["Timeout"]), { retested: 1, "src/a.ts": ALL_A.filter(id => id !== "timeout-a"), "src/b.tsx": ["compile-b", "survived-b2"] });
    assert.deepEqual(kept([], ["Survived"]), {
        retested: 5,
        "src/a.ts": ALL_A.filter(id => !id.startsWith("survived")),
        "src/b.tsx": ["compile-b"]
    });
});

test("a longer timeout flips the timed-out mutants, a shorter one the survivors, an unknown side either", () => {
    const flips = (/** @type {object | undefined} */ before, /** @type {object} */ after) =>
        [...timeoutFlips(before && JSON.stringify(before), JSON.stringify(after))].sort();
    assert.deepEqual(flips({ timeoutMS: 2000 }, { timeoutMS: 2000 }), []);
    assert.deepEqual(flips({ timeoutMS: 2000 }, { timeoutMS: 5000 }), ["Timeout"]);
    assert.deepEqual(flips({ timeoutMS: 5000, timeoutFactor: 1.5 }, { timeoutMS: 5000, timeoutFactor: 1 }), ["Survived"]);
    assert.deepEqual(flips({ timeoutMS: 2000, timeoutFactor: 2 }, { timeoutMS: 3000, timeoutFactor: 1 }), ["Survived", "Timeout"]);
    assert.deepEqual(flips({ timeoutMS: 2000 }, {}), ["Survived", "Timeout"]);
    assert.deepEqual(flips({}, { timeoutFactor: 2 }), ["Survived", "Timeout"]);
    assert.deepEqual(flips(undefined, {}), ["Survived", "Timeout"]);
});

test("changed inputs: a different value, or one only either run has", () => {
    assert.deepEqual(changedInputs({ "file:a": "1", "file:b": "2", "file:gone": "3" }, { "file:a": "1", "file:b": "9", "file:new": "4" }),
        new Set(["file:b", "file:gone", "file:new"]));
});

test("without a record of the last run, an input counts as changed when its file is newer than the result", () => {
    const current = { "file:test/dom.mjs": "1", "file:src/a.ts": "2", "package:react": "3", "config:vitest": "4", "config:stryker": "5", [TIMEOUT_INPUT]: "6" };
    const newer = new Set(["test/dom.mjs", "stryker.config.mjs"]);
    assert.deepEqual(assumedPrevious(current, file => newer.has(file)), { "file:src/a.ts": "2", "package:react": "3", "config:vitest": "4" });
    assert.deepEqual(Object.keys(assumedPrevious(current, file => file === "vitest.config.mjs")),
        ["file:test/dom.mjs", "file:src/a.ts", "package:react", "config:stryker", TIMEOUT_INPUT]);
    assert.deepEqual(Object.keys(assumedPrevious(current, file => file === "pnpm-lock.yaml")),
        ["file:test/dom.mjs", "file:src/a.ts", "config:vitest", "config:stryker", TIMEOUT_INPUT]);
});

test("configs: a change in an inert part leaves the fingerprint, any other changes it, functions and patterns by their source", () => {
    const base = { mutate: ["a"], concurrency: 2, testRunner: "vitest", plugins: [{ load: () => 1, find: /^x/ }] };
    const fingerprint = (/** @type {object} */ config) => configFingerprint(config, CONFIGS.stryker.inert);
    assert.equal(fingerprint(base), '{"testRunner":"vitest","plugins":[{"load":"() => 1","find":"/^x/"}]}');
    const inert = { mutate: ["a", "b"], concurrency: 4, reporters: [], thresholds: {}, incremental: false, timeoutMS: 1, timeoutFactor: 1 };
    assert.equal(fingerprint({ ...base, ...inert }), fingerprint(base));
    for (const changed of [{ testRunner: "command" }, { plugins: [{ load: () => 2, find: /^x/ }] }, { plugins: [{ load: () => 1, find: /^y/ }] }]) {
        assert.notEqual(fingerprint({ ...base, ...changed }), fingerprint(base));
    }
    const vitest = { test: { include: ["a"], coverage: { thresholds: { lines: 100 } } } };
    assert.equal(configFingerprint(vitest, CONFIGS.vitest.inert), '{"test":{"include":["a"]}}');
    assert.equal(configFingerprint({ plugins: [] }, CONFIGS.vitest.inert), '{"plugins":[]}');
});

test("an input's value: a file's hash, without the version numbers of package.json; a package's and a config's fingerprints", () => {
    const pkg = { name: "x", type: "module", version: "1.0.0", packageManager: "pnpm@1", engines: { node: ">=1" }, devDependencies: { a: "1" } };
    /** @type {Record<string, string>} */
    const files = { "src/a.ts": "export const a = 1;", "package.json": JSON.stringify(pkg) };
    const project = (/** @type {Record<string, string>} */ changed) => ({
        read: (/** @type {string} */ file) => ({ ...files, ...changed })[file],
        configs: { vitest: { test: { coverage: {} } }, stryker: { mutate: [], testRunner: "vitest", timeoutMS: 1 } },
        nodeModules: { realpath: () => undefined, readdir: () => [] }
    });
    const value = (/** @type {string} */ input, changed = {}) => inputValue(input, project(changed));
    assert.equal(value("file:src/a.ts"), "683314ed22112e8dea8095c8c6173afa2c61279f5fe07968ebe0e21fff16871d");
    assert.notEqual(value("file:src/a.ts", { "src/a.ts": "export const a = 2;" }), value("file:src/a.ts"));
    const bumped = { ...pkg, version: "2.0.0", packageManager: "pnpm@2", engines: { node: ">=2" }, dependencies: { b: "1" }, devDependencies: { a: "2" } };
    assert.equal(value("file:package.json", { "package.json": JSON.stringify(bumped) }), value("file:package.json"));
    assert.notEqual(value("file:package.json", { "package.json": JSON.stringify({ ...pkg, type: "commonjs" }) }), value("file:package.json"));
    assert.equal(value("package:react"), "absent");
    assert.equal(value("config:vitest"), "{\"test\":{}}");
    assert.equal(value("config:stryker"), "{\"testRunner\":\"vitest\"}");
    assert.equal(value(TIMEOUT_INPUT), "{\"timeoutMS\":1}");
});

test("a package's fingerprint: its installed version and every one it depends on, through scopes and cycles", () => {
    const store = "/repo/node_modules/.pnpm";
    /** @type {Record<string, string>} */
    const links = {
        "node_modules/a": `${store}/a@1.0.0/node_modules/a`,
        [`${store}/a@1.0.0/node_modules/@s/b`]: `${store}/@s+b@2.0.0/node_modules/@s/b`,
        [`${store}/@s+b@2.0.0/node_modules/a`]: `${store}/a@1.0.0/node_modules/a`,
        [`${store}/@s+b@2.0.0/node_modules/c`]: `${store}/c@3.0.0_x@1/node_modules/c`
    };
    /** @type {Record<string, string[]>} */
    const folders = {
        [`${store}/a@1.0.0/node_modules`]: [".bin", "@s", "a", "gone"],
        [`${store}/a@1.0.0/node_modules/@s`]: ["b"],
        [`${store}/@s+b@2.0.0/node_modules`]: ["@s", "a", "c"],
        [`${store}/@s+b@2.0.0/node_modules/@s`]: ["b"],
        [`${store}/c@3.0.0_x@1/node_modules`]: ["c"]
    };
    const fs = { realpath: (/** @type {string} */ path) => links[path], readdir: (/** @type {string} */ path) => folders[path] ?? [] };
    assert.equal(packageFingerprint("a", fs), "@s+b@2.0.0 a@1.0.0 c@3.0.0_x@1");
    assert.equal(packageFingerprint("electron", fs), "absent");
});
