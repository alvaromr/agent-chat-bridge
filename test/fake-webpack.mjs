// Discord's webpack runtime, made up: a `require` whose module factories, cache and chunk names are set the way Discord's
// bundle sets them, run as a script of https://discord.com/assets/, so mod/src/renderer/webpack.ts's hook takes it for
// Discord's own.
import { runInThisContext } from "node:vm";

/**
 * A webpack runtime loaded from `url`: it assigns `modules` to `wreq.m`, then its public path to `wreq.p`. `chunkName`
 * is the source of `wreq.u`; a null `path` leaves `wreq.p` unset.
 * @param {Record<string, unknown>} modules
 * @param {{ url?: string, path?: string | null, chunkName?: string, cache?: boolean, fromModule?: boolean }} [options]
 * @returns {any}
 */
export function loadWebpack(modules, {
    url = "https://discord.com/assets/web.0123abcd.js", path = "/assets/", chunkName = "function(e){return e+\".js\"}", cache = true,
    fromModule = false
} = {}) {
    const source = `(function (modules, path, chunkName, cache) {
        function wreq(id) {
            const cached = wreq.c[id];
            if (cached) return cached.exports;
            const module = wreq.c[id] = { exports:{}, loaded: false };
            wreq.m[id].call(module.exports, module, module.exports, wreq);
            module.loaded = true;
            return module.exports;
        }
        wreq.c = cache ? {} : null;
        wreq.u = chunkName;
        wreq.m = modules;
        if (path !== null) wreq.p = path;
        return wreq;
    })`;
    const start = runInThisContext(source, { filename: url });
    const run = () => start(modules, path, runInThisContext(`(${chunkName})`), cache);
    // A runtime that a module of another bundle starts, from inside that module's numbered factory.
    if (fromModule) return runInThisContext("({ 123(run) { return run(); } })", { filename: url })[123].call({}, run);
    return run();
}

/** A loaded module of the runtime, with these exports, as if its factory had run. */
export function loadedModule(wreq, id, exports) {
    wreq.c[id] = { exports, loaded: true };
}
