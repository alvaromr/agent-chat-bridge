// Which mutants a change since the last `pnpm mutation` can alter, for scripts/mutation.mjs. Stryker's incremental
// run re-tests the mutants in changed code and those whose killing test changed, but it can't see what else a mutant's
// tests run: the code and test helpers they import, the dependencies, the configs. This finds, through the import
// graph, the mutants whose tests or type-check reach such a change, so that only they are tested again. No I/O:
// scripts/mutation.mjs hands it the files, and test/ loads it directly.
import { createHash } from "node:crypto";
import { isBuiltin } from "node:module";
import { posix } from "node:path";

import ts from "typescript";

/**
 * An input of the mutants' results, as a key: `file:<repo path>`, `package:<name>` (with what it depends on) or
 * `config:<name>` (of CONFIGS). @typedef {string} Input
 */
/**
 * What each test file and each mutated file reach: a test file's results depend on everything it runs, a mutated
 * file's compile errors on everything its type-check reads.
 * @typedef {{ tests: Map<string, Set<Input>>, compile: Map<string, Set<Input>> }} InputGraph
 */
/**
 * The part of Stryker's incremental file read here.
 * @typedef {{ id: string, status: string, static?: boolean, coveredBy?: string[], killedBy?: string[] }} Mutant
 * @typedef {{ files: Record<string, { mutants: Mutant[] }>, testFiles?: Record<string, { tests: { id: string }[] }> }} Report
 */

/** What runs every test, so that a change in it reaches every mutant. */
const RUNNERS = ["vitest", "@stryker-mutator/core", "@stryker-mutator/vitest-runner"];
/** What type-checks every mutant (Stryker's `checkers`), so that a change in it reaches every compile error. */
const CHECKERS = ["typescript", "@stryker-mutator/typescript-checker"];
/**
 * The configs, by key: their file, and the parts of them that change neither which mutants exist (Stryker diffs those
 * itself) nor how their tests run, so a change there re-tests nothing.
 */
export const CONFIGS = {
    vitest: { file: "vitest.config.mjs", inert: [["test", "coverage"]] },
    stryker: { file: "stryker.config.mjs", inert: [["mutate"], ["concurrency"], ["reporters"], ["thresholds"], ["incremental"]] }
};
/**
 * Files the code imports with fields that are version numbers, which re-test nothing: the dependencies' own are seen
 * through what is installed (`packageFingerprint`).
 */
const VERSION_FIELDS = { "package.json": [["version"], ["packageManager"], ["engines"], ["dependencies"], ["devDependencies"]] };
const EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js"];
const CODE = /\.[cm]?[jt]sx?$/;
const JSX = /\.[jt]sx$/;
// As vitest finds it, anywhere in the file.
const ENVIRONMENT = /@(?:vitest|jest)-environment\s+([\w-]+)\b/;

/**
 * What a module imports: its import, export-from, require and import() specifiers, and the test environment it asks
 * for, which is a package unless it is Node's.
 * @param {string} source
 */
export function importsOf(source) {
    const imported = ts.preProcessFile(source, true, true).importedFiles.map(({ fileName }) => fileName);
    const environment = ENVIRONMENT.exec(source)?.[1];
    return environment && environment !== "node" ? [...imported, environment] : imported;
}

/**
 * The input a specifier imported by `from` stands for: a repo file, found as the resolver of vitest.config.mjs finds
 * it (aliases, then the path, with an extension, or a folder's index), or a package. Node's own modules are none.
 * @param {string} from the importing file, from the repo's root
 * @param {string} specifier
 * @param {{ find: RegExp, replacement: string }[]} aliases replacements from the repo's root
 * @param {(file: string) => string | undefined} read a repo file's text, undefined when there is none
 * @returns {Input | undefined}
 */
export function resolveImport(from, specifier, aliases, read) {
    if (isBuiltin(specifier)) return undefined;
    const alias = aliases.find(({ find }) => find.test(specifier));
    const path = alias ? specifier.replace(alias.find, alias.replacement)
        : specifier.startsWith(".") ? posix.join(posix.dirname(from), specifier) : undefined;
    if (path === undefined) {
        const [scope, name] = specifier.split("/");
        return `package:${scope?.startsWith("@") ? `${scope}/${name}` : scope}`;
    }
    const candidates = [path, ...EXTENSIONS.map(extension => path + extension), ...EXTENSIONS.map(extension => `${path}/index${extension}`)];
    const found = candidates.find(candidate => read(candidate) !== undefined);
    if (found === undefined) throw new Error(`Cannot resolve ${specifier} from ${from}`);
    return `file:${found}`;
}

/**
 * A tsconfig and the ones it extends, from the repo's root.
 * @param {string} file
 * @param {(file: string) => string | undefined} read
 * @returns {string[]}
 */
export function tsconfigChain(file, read) {
    const parent = ts.parseConfigFileTextToJson(file, /** @type {string} */ (read(file))).config.extends;
    return [file, ...typeof parent === "string" ? tsconfigChain(posix.join(posix.dirname(file), parent), read) : []];
}

/**
 * What each test file and each mutated file reach, through their imports.
 * @param {object} project
 * @param {string[]} project.tests the test files
 * @param {string[]} project.mutated the files Stryker mutates
 * @param {string[]} project.setupFiles what vitest loads before every test file
 * @param {{ find: RegExp, replacement: string }[]} project.aliases vitest's, with replacements from the repo's root
 * @param {string} project.jsxInject the code vitest's JSX transform adds to every JSX file
 * @param {string} project.tsconfig the type-check's config
 * @param {string[]} project.typePackages the `@types/` packages, which the type-check reads without an import
 * @param {(file: string) => string | undefined} project.read a repo file's text, undefined when there is none
 * @returns {InputGraph}
 */
export function inputGraph({ tests, mutated, setupFiles, aliases, jsxInject, tsconfig, typePackages, read }) {
    /** @type {Map<string, Input[]>} */
    const edges = new Map();
    /** @param {string} file */
    const importsFrom = file => {
        const source = /** @type {string} */ (read(file));
        const specifiers = CODE.test(file) ? [...importsOf(source), ...JSX.test(file) ? importsOf(jsxInject) : []] : [];
        return specifiers.map(specifier => resolveImport(file, specifier, aliases, read)).filter(input => input !== undefined);
    };
    /** @param {Input[]} roots */
    const reach = roots => {
        const seen = new Set(roots);
        for (const input of seen) {
            if (!input.startsWith("file:")) continue;
            const file = input.slice("file:".length);
            if (!edges.has(file)) edges.set(file, importsFrom(file));
            for (const next of /** @type {Input[]} */ (edges.get(file))) seen.add(next);
        }
        return seen;
    };
    const everyTest = [...setupFiles.map(file => `file:${file}`), ...RUNNERS.map(name => `package:${name}`), "config:vitest", "config:stryker"];
    const everyCheck = [...[...CHECKERS, ...typePackages].map(name => `package:${name}`),
        ...tsconfigChain(tsconfig, read).map(file => `file:${file}`), "config:stryker"];
    return {
        tests: new Map(tests.map(file => [file, reach([`file:${file}`, ...everyTest])])),
        compile: new Map(mutated.map(file => [file, reach([`file:${file}`, ...everyCheck])]))
    };
}

/**
 * The inputs whose value differs from the last run's, or that one of the two runs doesn't have.
 * @param {Record<Input, string>} previous
 * @param {Record<Input, string>} current
 */
export function changedInputs(previous, current) {
    return new Set([...Object.keys(previous), ...Object.keys(current)].filter(input => previous[input] !== current[input]));
}

/**
 * The last run's inputs when it left no record of them (a result from before the record existed): taken as the
 * current ones, except those whose file is newer than the result, which count as changed. A package counts as changed
 * when the lockfile is newer, since what it changed in is unknown.
 * @param {Record<Input, string>} current
 * @param {(file: string) => boolean} newer whether a repo file changed after the last result
 */
export function assumedPrevious(current, newer) {
    /** @param {Input} input */
    const fileOf = input => {
        const [kind, name] = input.split(/:(.*)/);
        if (kind === "package") return "pnpm-lock.yaml";
        return kind === "config" ? CONFIGS[/** @type {keyof typeof CONFIGS} */ (name)].file : /** @type {string} */ (name);
    };
    return Object.fromEntries(Object.entries(current).filter(([input]) => !newer(fileOf(input))));
}

/**
 * A config's value as text, without its inert parts, with its functions and regular expressions as their source.
 * @param {unknown} config
 * @param {string[][]} inert paths of keys
 */
export function configFingerprint(config, inert) {
    /** @type {(value: any, path: string[]) => any} */
    const omit = (value, [key, ...rest]) => {
        const { [/** @type {string} */ (key)]: inner, ...others } = value;
        return rest.length && inner !== undefined ? { ...others, [/** @type {string} */ (key)]: omit(inner, rest) } : others;
    };
    return JSON.stringify(inert.reduce(omit, config), (_, value) => typeof value === "function" || value instanceof RegExp ? String(value) : value);
}

/**
 * The installed versions of a package and of everything it depends on, as pnpm lays them out: each one at
 * `.pnpm/<name>@<version>…/node_modules/<name>`, next to links to what it depends on. "absent" when it isn't installed.
 * @param {string} name
 * @param {{ realpath: (path: string) => string | undefined, readdir: (path: string) => string[] }} fs `realpath` with
 *   forward slashes, undefined for a missing path
 */
export function packageFingerprint(name, { realpath, readdir }) {
    const versions = new Set();
    /** @param {string} link @param {string} dependency */
    const visit = (link, dependency) => {
        const path = realpath(link);
        if (path === undefined) return;
        const modules = path.slice(0, -dependency.length - 1);
        const version = posix.basename(posix.dirname(modules));
        if (versions.has(version)) return;
        versions.add(version);
        // The package itself, and `.bin`, lead back to this same version.
        const names = readdir(modules).flatMap(entry => entry.startsWith("@") ? readdir(`${modules}/${entry}`).map(inner => `${entry}/${inner}`) : [entry]);
        for (const next of names) visit(`${modules}/${next}`, next);
    };
    visit(`node_modules/${name}`, name);
    return versions.size ? [...versions].sort().join(" ") : "absent";
}

/**
 * An input's current value: a file's hash (without its version numbers), a package's fingerprint, a config's.
 * @param {Input} input
 * @param {object} project
 * @param {(file: string) => string | undefined} project.read a repo file's text, undefined when there is none
 * @param {Record<keyof typeof CONFIGS, unknown>} project.configs the loaded configs
 * @param {Parameters<typeof packageFingerprint>[1]} project.nodeModules
 */
export function inputValue(input, { read, configs, nodeModules }) {
    const [kind, name] = /** @type {[string, string]} */ (input.split(/:(.*)/));
    if (kind === "package") return packageFingerprint(name, nodeModules);
    if (kind === "config") return configFingerprint(configs[/** @type {keyof typeof CONFIGS} */ (name)], CONFIGS[/** @type {keyof typeof CONFIGS} */ (name)].inert);
    const text = /** @type {string} */ (read(name));
    const versioned = VERSION_FIELDS[/** @type {keyof typeof VERSION_FIELDS} */ (name)];
    return createHash("sha256").update(versioned ? configFingerprint(JSON.parse(text), versioned) : text).digest("hex");
}

/**
 * The report without the mutants whose result a change in `changed` can alter, so that Stryker tests them again.
 * A test file's change reaches the mutants its tests cover, or killed, and a static mutant or one no test is known
 * for runs every test; a compile error is reached only by its type-check's inputs; an ignored mutant by none.
 * @param {Report} report
 * @param {InputGraph} graph
 * @param {Set<Input>} changed
 * @returns {{ report: Report, retested: number }}
 */
export function withoutStale(report, graph, changed) {
    /** @param {Set<Input>} inputs */
    const reaches = inputs => [...inputs].some(input => changed.has(input));
    const affected = new Set([...graph.tests].filter(([, inputs]) => reaches(inputs)).map(([file]) => file));
    const fileOfTest = new Map(Object.entries(report.testFiles ?? {}).flatMap(([file, { tests }]) => tests.map(({ id }) => [id, file])));
    /** @param {string} id */
    const affectedTest = id => {
        const file = fileOfTest.get(id);
        return file === undefined ? affected.size > 0 : affected.has(file);
    };
    /** @param {Mutant} mutant @param {string} file */
    const stale = (mutant, file) => {
        if (mutant.status === "Ignored") return false;
        if (mutant.status === "CompileError") {
            const inputs = graph.compile.get(file);
            return inputs !== undefined && reaches(inputs);
        }
        const killed = mutant.status === "Killed";
        const tests = killed ? mutant.killedBy : [...mutant.coveredBy ?? [], ...mutant.killedBy ?? []];
        return !tests?.length || mutant.static && !killed ? affected.size > 0 : tests.some(affectedTest);
    };
    let retested = 0;
    const files = Object.fromEntries(Object.entries(report.files).map(([file, entry]) => {
        const mutants = entry.mutants.filter(mutant => !stale(mutant, file));
        retested += entry.mutants.length - mutants.length;
        return [file, { ...entry, mutants }];
    }));
    return { report: { ...report, files }, retested };
}
