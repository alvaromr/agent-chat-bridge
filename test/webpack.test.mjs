// @vitest-environment happy-dom
// The hook into Discord's webpack (mod/src/renderer/webpack.ts), on a made-up webpack runtime served as Discord's
// (test/fake-webpack.mjs): which runtime it takes, how it patches module factories, and how it finds modules. Each test
// loads the module afresh, as the hook takes only the first runtime that passes. Run with `pnpm test`.
import assert from "node:assert/strict";
import { runInThisContext } from "node:vm";

import { beforeEach, test, vi } from "vitest";

import { loadedModule, loadWebpack } from "./fake-webpack.mjs";

/** @returns {Promise<typeof import("../mod/src/renderer/webpack.ts")>} */
async function fresh() {
    vi.resetModules();
    return import("../mod/src/renderer/webpack.ts");
}

let info, error;
beforeEach(() => {
    vi.useRealTimers();
    info = vi.spyOn(console, "log").mockImplementation(() => { });
    error = vi.spyOn(console, "error").mockImplementation(() => { });
});

const exportsA = function (module) {
    module.exports = { a: 1 };
};

test("webpack: Discord's main runtime gets its factories wrapped, the later ones too, and its modules can be found", async () => {
    const { find } = await fresh();
    const wreq = loadWebpack({ 1: exportsA, 2: 7 });
    assert.deepEqual(info.mock.calls, [["[agent-chat-bridge] Hooked into Discord's webpack"]]);
    assert.notEqual(wreq.m[1], exportsA);
    assert.equal(String(wreq.m[1]), String(exportsA), "lookups by source see Discord's code");
    assert.equal(wreq.m[2], 7, "what isn't a factory stays as it is");
    assert.deepEqual(wreq(1), { a: 1 });
    assert.equal(wreq.m[1], exportsA, "after its run, the original factory is back");
    const later = function (module) {
        module.exports = { b: 2 };
    };
    wreq.m[3] = later;
    assert.notEqual(wreq.m[3], later, "a later chunk's factory is wrapped too");
    wreq(3);
    assert.deepEqual(find(m => m.b === 2), { b: 2 });
    assert.equal(wreq.p, "/assets/");
});

test("webpack: a runtime that isn't Discord's main one is left alone", async () => {
    const cases = [
        { url: "file:///Users/x/web.0123abcd.js" },
        { fromModule: true },
        { url: "https://discord.com/assets/sentry.0123abcd.js" },
        { url: "https://discord.com/assets/libdiscore.0123abcd.js" },
        { url: "https://discord.com/assets/Fast-Connect.0123abcd.js" },
        { path: "/other/" },
        { cache: false },
        { chunkName: 'function(e){return"libdiscore-wasm.js"}' },
        { chunkName: 'e=>"libdiscore-wasm.js"+""' }
    ];
    for (const options of cases) {
        const { find } = await fresh();
        const wreq = loadWebpack({ 1: exportsA }, options);
        assert.equal(wreq.m[1], exportsA, JSON.stringify(options));
        if (wreq.c) wreq(1);
        assert.equal(find(() => true), null, JSON.stringify(options));
    }
    assert.equal(info.mock.calls.length, 0);
});

test("webpack: a script under another path than /assets/ still counts as Discord's", async () => {
    await fresh();
    const wreq = loadWebpack({ 1: exportsA }, { url: "https://discord.com/app" });
    assert.notEqual(wreq.m[1], exportsA);
});

test("webpack: a function without webpack's module shape is left alone", async () => {
    const { find } = await fresh();
    /** @type {any} */
    const other = Object.assign(function () { }, { c: {}, u: () => "x.js" });
    runInThisContext("(function (f, m) { f.m = m; f.p = \"/assets/\"; })", { filename: "https://discord.com/assets/web.0123abcd.js" })(other, { 1: exportsA });
    assert.equal(other.m[1], exportsA);
    assert.equal(find(() => true), null);
});

test("webpack: the hooked runtime's factories and path stay plain, writable properties; the hooks themselves don't show", async () => {
    await fresh();
    assert.equal(Object.getOwnPropertyDescriptor(Function.prototype, "m")?.enumerable, false);
    const waiting = loadWebpack({ 1: exportsA }, { path: null });
    assert.equal(Object.getOwnPropertyDescriptor(waiting, "p")?.enumerable, false, "the path's setter, while it waits");
    waiting.p = "/assets/";
    const plain = { enumerable: true, writable: true, configurable: true };
    const { value: m, ...mRest } = /** @type {any} */ (Object.getOwnPropertyDescriptor(waiting, "m"));
    assert.deepEqual(mRest, plain);
    assert.equal(m[1] === exportsA, false, "wrapped");
    assert.deepEqual(Object.getOwnPropertyDescriptor(waiting, "p"), { value: "/assets/", ...plain });
    await new Promise(r => setTimeout(r, 5));
    assert.equal(waiting.p, "/assets/", "the path stays once set");
});

test("webpack: a module that throws without any patch applied runs once, and fails as it would in Discord, unlogged", async () => {
    const webpack = await fresh();
    const factory = vi.fn(() => {
        throw new Error("suyo");
    });
    assert.throws(() => webpack.wrapFactory({ 1: factory }, 1, factory)(), { message: "suyo" });
    assert.equal(factory.mock.calls.length, 1);
    assert.equal(error.mock.calls.length, 0);
});

test("webpack: a patch already applied to its module isn't applied to another one", async () => {
    const done = { ...patch("hecho", '"a"', /"a"/, '"b"'), status: "ok" };
    const { result } = await runPatched(factoryOf('function () { return "a"; }'), [done]);
    assert.equal(result, "a");
});

test("webpack: only the first main runtime is hooked", async () => {
    await fresh();
    loadWebpack({ 1: exportsA });
    const second = loadWebpack({ 1: exportsA });
    assert.equal(second.m[1], exportsA);
    assert.equal(info.mock.calls.length, 1);
});

test("webpack: a runtime that doesn't set its path at once stops being watched", async () => {
    const { find } = await fresh();
    const wreq = loadWebpack({ 1: exportsA }, { path: null });
    await new Promise(r => setTimeout(r, 5));
    wreq.p = "/assets/";
    assert.equal(wreq.m[1], exportsA);
    assert.equal(find(() => true), null);
});

/** A factory from its source, so its text is exactly that. */
const factoryOf = source => runInThisContext(`(${source})`);

/** Runs a made-up module, patched by new patches, as Discord would run it. */
async function runPatched(factory, newPatches) {
    const webpack = await fresh();
    webpack.patches.push(...newPatches);
    return { ...webpack, result: webpack.wrapFactory({ 1: factory }, 1, factory)() };
}
const patch = (name, find, match, replace) => ({ name, find, match, replace });

test("webpack: patches whose text the module has apply in turn, and are shown as applied", async () => {
    const one = patch("uno", '"a"', /"a"/, '"b"'), two = patch("dos", '"a"', /"b"/, '"c"'), other = patch("otro", '"z"', /"z"/, '"y"');
    const { result } = await runPatched(factoryOf('function () { return "a"; }'), [one, two, other]);
    assert.equal(result, "c");
    assert.deepEqual([one.status, two.status, other.status], ["ok", "ok", undefined]);
    assert.deepEqual(info.mock.calls, [["[agent-chat-bridge] Patch applied: uno"], ["[agent-chat-bridge] Patch applied: dos"]]);
});

test("webpack: a factory written as a method or an arrow is patched as well, and `\\i` stands for any identifier", async () => {
    const method = patch("método", "x", /return (\i)/, "return $1+1");
    assert.equal((await runPatched(factoryOf("{ 1(x) { return x; } }")[1], [method])).result, NaN);
    assert.equal(method.status, "ok");
    const arrow = patch("flecha", "y", /(\i)\*2/, "$1*3");
    assert.equal((await runPatched(factoryOf("(y = 2) => y*2"), [arrow])).result, 6);
    assert.equal(arrow.status, "ok");
});

test("webpack: a patch whose replacement changes nothing, or breaks the code, fails alone", async () => {
    const same = patch("igual", '"a"', /"a"/, '"a"'), broken = patch("roto", '"a"', /"a"/, '"a" +'), good = patch("bien", '"a"', /"a"/, '"b"');
    const { result } = await runPatched(factoryOf('function () { return "a"; }'), [same, broken, good]);
    assert.equal(result, "b");
    assert.deepEqual([same.status, broken.status, good.status], ["failed", "failed", "ok"]);
    assert.deepEqual(error.mock.calls.map(([text]) => text), ["[agent-chat-bridge] Patch failed: igual", "[agent-chat-bridge] Patch failed: roto"]);
    assert.equal(error.mock.calls[0][1].message, "the replacement changed nothing");
});

test("webpack: a patched module that fails falls back to the original, and its patches are shown as failed", async () => {
    const one = patch("uno", '"a"', /return "a"/, 'throw new Error("boom")'), two = patch("dos", '"a"', /\(\)/, "( )");
    const { result } = await runPatched(factoryOf('function () { return "a"; }'), [one, two]);
    assert.equal(result, "a", "the original module ran");
    assert.deepEqual([one.status, two.status], ["failed", "failed"]);
    assert.equal(error.mock.calls.at(-1)[0], "[agent-chat-bridge] A patched module failed; using the original, without uno, dos");
    assert.equal(error.mock.calls.at(-1)[1].message, "boom");
});

test("webpack: a module that fails without patches fails as it would in Discord", async () => {
    const webpack = await fresh();
    const factory = () => {
        throw new Error("suyo");
    };
    assert.throws(() => webpack.wrapFactory({ 1: factory }, 1, factory)(), { message: "suyo" });
    webpack.patches.push({ ...patch("ya", "x", /x/, "y"), status: "ok" });
    assert.throws(() => webpack.wrapFactory({ 1: factory }, 1, factory)(), { message: "suyo" }, "patches already applied elsewhere don't count");
    assert.equal(webpack.wrapFactory({}, 1, "no es función"), "no es función");
});

test("webpack: the factory runs with webpack's `this` and arguments", async () => {
    const webpack = await fresh();
    /** @this {unknown} */
    const factory = function (...args) {
        return [this, ...args];
    };
    const self = {};
    assert.deepEqual(webpack.wrapFactory({ 1: factory }, 1, factory).call(self, 1, 2), [self, 1, 2]);
    webpack.patches.push(patch("p", "args", /args\]/, "args, 3]"));
    const patched = webpack.wrapFactory({ 1: factory }, 1, factory).call(self, 1, 2);
    assert.ok(patched[0] === self, "the same this");
    assert.deepEqual(patched.slice(1), [1, 2, 3]);
});

/** A hooked runtime whose loaded modules export these values, by id. */
async function withModules(exportsById) {
    const webpack = await fresh();
    const wreq = loadWebpack({});
    for (const [id, exports] of Object.entries(exportsById)) loadedModule(wreq, id, exports);
    return { ...webpack, wreq };
}

test("find: the first loaded module, or export of one, that passes the filter", async () => {
    const nested = { n: 1 };
    const { find, wreq } = await withModules({ 1: { top: 1 }, 2: { inner: nested } });
    wreq.c[0] = { exports: { top: 0 }, loaded: false };
    wreq.c[3] = { exports: null, loaded: true };
    wreq.c[4] = undefined;
    assert.deepEqual(find(m => m.top !== undefined), { top: 1 });
    assert.equal(find(m => m.n === 1), nested);
    assert.equal(find(m => m.n === 1, { topLevelOnly: true }), null);
    assert.equal(find(() => false), null);
});

test("find: a function module's own properties aren't searched, nor exports that throw or aren't ready", async () => {
    const fn = Object.assign(() => { }, { inner: { k: 1 } });
    const throwing = {};
    Object.defineProperty(throwing, "later", { enumerable: true, get: () => { throw new Error("circular"); } });
    throwing.ok = { k: 2 };
    const { find } = await withModules({ 1: fn, 2: throwing });
    assert.deepEqual(find(m => m.k !== undefined), { k: 2 });
});

test("find: a filter that throws on an export just doesn't match it", async () => {
    const { find } = await withModules({ 1: { a: { deep: 1 } }, 2: { b: 1 } });
    assert.deepEqual(find(m => m.a.deep === 1 || m.b === 1), { a: { deep: 1 } });
    assert.deepEqual(find(m => m.b.x === undefined), { b: 1 });
});

test("find: exports that would pass any filter are skipped", async () => {
    const tokens = { [Symbol.toStringTag]: "DOMTokenList" }, intl = { [Symbol.toStringTag]: "IntlMessagesProxy" };
    const anyKey = new Proxy({}, { get: () => "x", deleteProperty: () => true });
    const deleted = vi.fn((/** @type {object} */ _target, /** @type {PropertyKey} */ _key) => true);
    const spy = new Proxy({}, { get: (_, key) => key === "is this a proxy that returns values for any key?" ? "x" : undefined, deleteProperty: deleted });
    const skipped = [window, document, document.documentElement, tokens, intl, anyKey, spy, new Uint8Array(1), null];
    const modules = await withModules({ ...skipped });
    assert.ok(modules.find(() => true, { topLevelOnly: true }) === null, "no module");
    const exports = await withModules({ 1: Object.fromEntries(skipped.map((value, i) => [i, value])) });
    assert.ok(exports.find(m => m !== exports.wreq.c[1].exports) === null, "nor an export of one");
    assert.deepEqual(deleted.mock.calls[0]?.[1], "is this a proxy that returns values for any key?");
});

test("find: before Discord's runtime is hooked, nothing is found", async () => {
    const { find, findInModule } = await fresh();
    assert.equal(find(() => true), null);
    assert.equal(findInModule("x", () => true), null);
});

test("findInModule: the export that passes the filter, in the module whose factory has the text", async () => {
    const webpack = await fresh();
    const wreq = loadWebpack({
        1: function (module) {
            module.exports = { other: 1 };
        },
        2: function (module) {
            module.exports = { first: "marca", wanted: { w: 1 } };
        }
    });
    assert.deepEqual(webpack.findInModule('"marca"', m => m.w === 1), { w: 1 });
    assert.equal(webpack.findInModule('"marca"', m => m.zz === 1), null);
    assert.equal(webpack.findInModule('"nadie"', () => true), null);
    assert.deepEqual(wreq.c[1], undefined, "modules without the text aren't run");
});

test("filters: by props, by code, by store name, and by code inside memo and forwardRef", async () => {
    const { filters } = await fresh();
    assert.equal(filters.byProps("a", "b")({ a: 0, b: null }), true);
    assert.equal(filters.byProps("a", "b")({ a: 0 }), false);
    function component() {
        return "marca uno dos";
    }
    component.toString = () => "otra cosa";
    assert.equal(filters.byCode("marca", "dos")(component), true, "Discord's own source, not an overridden toString");
    assert.equal(filters.byCode("marca", "tres")(component), false);
    assert.equal(filters.byCode("marca")({ toString: () => "marca" }), false);
    assert.equal(filters.byStoreName("UserStore")(new (class { static displayName = "UserStore"; })()), true);
    assert.equal(filters.byStoreName("UserStore")(new (class { static displayName = "Other"; })()), false);
    const byCode = filters.componentByCode("marca");
    const memo = { $$typeof: Symbol.for("react.memo"), type: { $$typeof: Symbol.for("react.forward_ref"), render: component } };
    assert.equal(byCode(component), true);
    assert.equal(byCode(memo), true);
    assert.equal(byCode({ $$typeof: Symbol.for("react.memo"), type: { render: () => "nada" } }), false);
    assert.equal(byCode({ type: component }), false, "only React's wrappers are looked into");
    assert.equal(byCode({ $$typeof: Symbol.for("react.memo") }), false);
});

test("findCssClasses: Discord's hashed names for readable ones, from the module that has them all", async () => {
    const { findCssClasses } = await withModules({
        0: Object.assign(() => { }, { button: "button_f0", wrapper: "wrapper_f0" }),
        1: { nested: { button: "button_n1", wrapper: "wrapper_n1" }, button: "button_x1" },
        2: { button: "button_a1 extra", wrapper: "wrapper_b2", dot: "notificationDot", n: 1 },
        3: { nested: { button: "button_c3", wrapper: "wrapper_c3" } }
    });
    assert.deepEqual(findCssClasses("button", "wrapper"), { button: "button_a1 extra", wrapper: "wrapper_b2" });
    assert.deepEqual(findCssClasses("notificationDot"), { notificationDot: "notificationDot" });
    assert.deepEqual(findCssClasses("button", "nadie"), { button: "", nadie: "" });
});

test("lazy: looked up on first use and kept; a piece Discord no longer has throws, naming it", async () => {
    const { lazy } = await fresh();
    const get = vi.fn(() => ({ ok: true }));
    const piece = lazy("Pieza", get);
    assert.equal(get.mock.calls.length, 0);
    assert.ok(piece() === piece(), "the same value");
    assert.equal(get.mock.calls.length, 1);
    const missing = vi.fn(() => null);
    const gone = lazy("Perdida", missing);
    assert.throws(gone, { message: "[agent-chat-bridge] Perdida not found in Discord" });
    assert.throws(gone);
    assert.equal(missing.mock.calls.length, 2, "looked up again next time");
});
