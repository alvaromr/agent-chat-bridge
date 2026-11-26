// What differs between systems and is pure: the app's folder and the CLI's socket (mod/src/platform.mts), and where
// claude is and what it runs with (plugins/shared/run.ts). Run with `pnpm test`.
import assert from "node:assert/strict";

import { test } from "vitest";

import { appDataDir, isPipe, socketPath } from "../mod/src/platform.mts";
import { claudeProcess } from "../plugins/shared/run.ts";

test("platform: the app data folder is Electron's on each system, and Linux's follows XDG_CONFIG_HOME when set", () => {
    /** @type {[string, Record<string, string>, string][]} */
    const cases = [
        ["darwin", { APPDATA: "x", XDG_CONFIG_HOME: "x" }, "/Users/ana/Library/Application Support"],
        ["win32", { APPDATA: "C:\\Users\\ana\\AppData\\Roaming" }, "C:\\Users\\ana\\AppData\\Roaming"],
        ["win32", {}, "/Users/ana\\AppData\\Roaming"],
        ["linux", { XDG_CONFIG_HOME: "/home/ana/conf" }, "/home/ana/conf"],
        ["linux", { XDG_CONFIG_HOME: "" }, "/Users/ana/.config"],
        ["freebsd", {}, "/Users/ana/.config"]
    ];
    for (const [platform, env, folder] of cases) assert.equal(appDataDir(platform, env, "/Users/ana"), folder, `${platform} ${JSON.stringify(env)}`);
});

test("platform: the socket is a file in the app's folder, or on Windows a named pipe of the user's own", () => {
    assert.equal(socketPath("darwin", "/a", "ana"), "/a/agent-chat-bridge/compose.sock");
    assert.equal(socketPath("linux", "/b", "ana"), "/b/agent-chat-bridge/compose.sock");
    assert.equal(socketPath("win32", "C:\\x", "ana"), "\\\\.\\pipe\\agent-chat-bridge-ana-compose");
    assert.deepEqual(["darwin", "linux", "win32"].map(isPipe), [false, false, true]);
});

test("run: claude is where its native installer puts it, with the least environment each system needs", () => {
    const env = { USER: "ana", APPDATA: "C:\\R", LOCALAPPDATA: "C:\\L", SystemRoot: "C:\\Windows", SECRET: "no" };
    assert.deepEqual(claudeProcess("darwin", env, "/Users/ana", "/tmp"), {
        bin: "/Users/ana/.local/bin/claude",
        env: { HOME: "/Users/ana", USER: "ana", PATH: "/usr/bin:/bin", TMPDIR: "/tmp" }
    });
    assert.deepEqual(claudeProcess("linux", env, "/home/ana", "/tmp").bin, "/home/ana/.local/bin/claude");
    assert.deepEqual(claudeProcess("win32", env, "C:\\Users\\ana", "C:\\T"), {
        bin: "C:\\Users\\ana\\.local\\bin\\claude.exe",
        env: {
            USERPROFILE: "C:\\Users\\ana",
            APPDATA: "C:\\R",
            LOCALAPPDATA: "C:\\L",
            SystemRoot: "C:\\Windows",
            PATH: "C:\\Windows\\System32",
            TEMP: "C:\\T",
            TMP: "C:\\T"
        }
    });
});
