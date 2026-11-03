// Hooks Discord's webpack to patch module source before it runs and to look up its loaded modules: only the main
// Discord instance, lazy patching (on first run of each module) and lookups by filter (regexes in ./regex.ts).
import { canonicalize, classNameRegex } from "./regex";

export interface Patch {
    /** Shown in the settings modal and in console warnings. */
    name: string;
    /** Text that only the target module contains. */
    find: string;
    /** `\i` stands for any identifier. */
    match: RegExp;
    replace: string | ((substring: string, ...groups: string[]) => string);
    status?: "ok" | "failed";
}

export type Filter = (m: any) => boolean;

export const patches: Patch[] = [];
let wreq: any;

const define = (target: object, key: PropertyKey, attributes: PropertyDescriptor) =>
    Reflect.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        ...(Object.hasOwn(attributes, "value") ? { writable: true } : {}),
        ...attributes
    });

// Every webpack instance assigns its module factories to `wreq.m`; this setter catches the assignment.
define(Function.prototype, "m", {
    enumerable: false,
    set(this: any, modules: Record<PropertyKey, any>) {
        define(this, "m", { value: modules });

        // Only Discord's own bundles, not libraries or extensions that also use webpack.
        const { stack } = new Error();
        if (!stack?.includes("http") || stack.match(/at \d+? \(/) || !String(this).includes("exports:{}")) return;
        const fileName = stack.match(/\/assets\/(.+?\.js)/)?.[1]?.toLowerCase();
        if (["sentry", "libdiscore", "fast-connect"].some(name => fileName?.includes(name))) return;

        // Only the instance that loads chunks from /assets/ is Discord's main one.
        define(this, "p", {
            enumerable: false,
            set(this: any, bundlePath: string) {
                define(this, "p", { value: bundlePath });
                clearTimeout(timeout);
                // libdiscore's instance also uses /assets/, but always returns one fixed chunk file name.
                if (wreq || bundlePath !== "/assets/" || this.c == null || /(?:=>|{return)"[^"]+?"[^=]/.test(String(this.u))) return;

                // `this` is Discord's webpack require itself, kept for the lookups; not an alias of the closure.
                // eslint-disable-next-line @typescript-eslint/no-this-alias
                wreq = this;
                hookFactories(this, modules);
                console.log("[discord-mod] Hooked into Discord's webpack");
            }
        });
        const timeout = setTimeout(() => Reflect.deleteProperty(this, "p"), 0);
    }
});

function hookFactories(instance: any, modules: Record<PropertyKey, any>) {
    for (const id in modules) modules[id] = wrapFactory(modules, id, modules[id]);

    // Chunks loaded later add their factories through `wreq.m`.
    define(instance, "m", {
        value: new Proxy(modules, {
            set: (target, id, factory, receiver) => Reflect.set(target, id, wrapFactory(target, id, factory), receiver)
        })
    });
}

/**
 * Defers patching until the module first runs; then puts the original factory back, as it never runs again. Exported
 * for its test.
 */
export function wrapFactory(modules: Record<PropertyKey, any>, id: PropertyKey, factory: any) {
    if (typeof factory !== "function") return factory;

    const wrapper = function (this: unknown, ...args: unknown[]) {
        modules[id] = factory;
        const { patched, applied } = patchFactory(id, factory);
        try {
            return patched.apply(this, args);
        } catch (err) {
            if (patched === factory) throw err;
            // The original runs instead, so the settings modal must not show these patches as applied.
            for (const patch of applied) patch.status = "failed";
            console.error(`[discord-mod] A patched module failed; using the original, without ${applied.map(p => p.name).join(", ")}`, err);
            return factory.apply(this, args);
        }
    };
    // Lookups by factory source must see Discord's code, not the wrapper's.
    wrapper.toString = factory.toString.bind(factory);
    return wrapper;
}

/** The factory with every pending patch whose `find` it contains, and the patches that applied. */
function patchFactory(id: PropertyKey, factory: any): { patched: any; applied: Patch[]; } {
    const pending = patches.filter(p => !p.status);
    const applied: Patch[] = [];
    if (!pending.length) return { patched: factory, applied };

    const source = String(factory);
    // Factories may be methods ("123(e,t,n){…}"); turn them into an expression that eval can return.
    let code = "0," + (source.startsWith("(") ? "" : "function") + source.slice(source.indexOf("("));
    let patched = factory;

    for (const patch of pending) {
        if (!source.includes(patch.find)) continue;

        const next = code.replace(canonicalize(patch.match), patch.replace as any);
        try {
            if (next === code) throw new Error("the replacement changed nothing");
            patched = (0, eval)(`${next}\n//# sourceURL=file:///DiscordModWebpack${String(id)}`);
            code = next;
            patch.status = "ok";
            applied.push(patch);
            console.log(`[discord-mod] Patch applied: ${patch.name}`);
        } catch (err) {
            patch.status = "failed";
            console.error(`[discord-mod] Patch failed: ${patch.name}`, err);
        }
    }
    return { patched, applied };
}

const PROXY_CHECK = "is this a proxy that returns values for any key?";
const TypedArray = Object.getPrototypeOf(Int8Array);

/** Exports that would match any props filter or are unsafe to inspect. */
function shouldIgnore(value: any) {
    if (value == null || value === window || value === document || value === document.documentElement) return true;
    if (value[Symbol.toStringTag] === "DOMTokenList" || value[Symbol.toStringTag] === "IntlMessagesProxy") return true;
    if (value[PROXY_CHECK] !== void 0) {
        Reflect.deleteProperty(value, PROXY_CHECK);
        return true;
    }
    return value instanceof TypedArray;
}

function matches(filter: Filter, value: any) {
    try {
        return !shouldIgnore(value) && filter(value);
    } catch {
        // Filters probe every export, and some exports throw on property access: that export just isn't the one. A
        // piece that no export matches fails loudly in lazy().
        return false;
    }
}

/** First loaded module export (or the module itself) that passes the filter. */
export function find(filter: Filter, { topLevelOnly = false } = {}) {
    for (const id in wreq?.c) {
        const mod = wreq.c[id];
        if (!mod?.loaded || mod.exports == null) continue;
        if (matches(filter, mod.exports)) return mod.exports;
        if (typeof mod.exports !== "object" || topLevelOnly) continue;

        for (const key in mod.exports) {
            let nested: any;
            try {
                nested = mod.exports[key];
            } catch {
                continue; // not initialized yet because of a circular import
            }
            if (matches(filter, nested)) return nested;
        }
    }
    return null;
}

/** Export that passes the filter, inside the module whose factory source contains `code`. */
export function findInModule(code: string, filter: Filter) {
    for (const id in wreq?.m) {
        if (!String(wreq.m[id]).includes(code)) continue;
        const mod = wreq(id);
        for (const key in mod) if (matches(filter, mod[key])) return mod[key];
    }
    return null;
}

export const filters = {
    byProps: (...props: string[]): Filter => m => props.every(p => m[p] !== void 0),
    byCode: (...code: string[]): Filter => m => {
        if (typeof m !== "function") return false;
        const source = Function.prototype.toString.call(m);
        return code.every(c => source.includes(c));
    },
    byStoreName: (name: string): Filter => m => m.constructor?.displayName === name,
    /** Also looks inside memo and forwardRef wrappers. */
    componentByCode: (...code: string[]): Filter => {
        const byCode = filters.byCode(...code);
        return m => {
            for (let inner = m; inner != null; inner = inner.type ?? inner.render) {
                if (byCode(inner)) return true;
                if (!inner.$$typeof) return false;
            }
            return false;
        };
    }
};

/** Maps Discord's hashed CSS class names ("button_a1b2") to their readable names; empty if not found. */
export function findCssClasses<S extends string>(...names: S[]): Record<S, string> {
    const regexes = names.map(name => ({ name, re: classNameRegex(name) }));
    const mod = find(m => typeof m === "object" && regexes.every(({ re }) => Object.values(m).some(v => typeof v === "string" && re.test(v))), { topLevelOnly: true });
    const values = mod ? Object.values(mod) : [];
    return Object.fromEntries(regexes.map(({ name, re }) => [name, values.find(v => typeof v === "string" && re.test(v)) ?? ""])) as Record<S, string>;
}

/** Resolves once, on first call; throws a readable error if Discord no longer has it. */
export function lazy<T>(name: string, get: () => T | null | undefined) {
    let value: T | null | undefined;
    return () => {
        value ??= get();
        if (value == null) throw new Error(`[discord-mod] ${name} not found in Discord`);
        return value;
    };
}
