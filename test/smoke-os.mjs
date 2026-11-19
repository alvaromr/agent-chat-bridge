// The system's side for real, on the machine it runs on, without Discord: the CLI reaching a socket where
// mod/src/platform.mts puts it (a named pipe on Windows), the check of a running Discord through the system's own
// command, and on Windows the scheduled task and the PowerShell script it runs. Run with `pnpm smoke-os`, and by CI on
// Windows and Linux (.github/workflows/ci.yml), the systems no one runs it on by hand
// (docs/decisions/windows-linux-untested.md). It serves no Discord data: the socket answers an empty list.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { APP_NAME } from "../mod/src/name.mts";
import { appDataDir, isPipe, socketPath } from "../mod/src/platform.mts";
import { exec } from "../scripts/os/exec.mjs";
import { system } from "../scripts/os/index.mjs";

const CLI = fileURLToPath(new URL("../scripts/agent-chat-bridge.mjs", import.meta.url));
const TASK = `${APP_NAME}-repatch`;
// What runs only on CI's machines: they have no Discord, and no install of the user's whose task it would replace.
const CI = Boolean(process.env.CI);

test("smoke: the CLI sends its request to the app's socket and prints the answer", async () => {
    // A home of its own, so a running Discord's socket is never touched; a pipe has no folder and is named by the user.
    const home = mkdtempSync(join(tmpdir(), "smoke-os-"));
    const env = { ...process.env, HOME: home, APPDATA: join(home, "AppData", "Roaming"), XDG_CONFIG_HOME: "" };
    const path = socketPath(process.platform, appDataDir(process.platform, env, home), userInfo().username);
    if (!isPipe(process.platform)) mkdirSync(dirname(path), { recursive: true });
    const requests = [];
    const server = createServer(conn => {
        conn.setEncoding("utf8");
        conn.on("data", line => {
            requests.push(line);
            conn.end(JSON.stringify({ ok: true, chats: [] }) + "\n");
        });
    });
    await new Promise((resolve, reject) => server.once("error", reject).listen(path, () => resolve(undefined)));
    try {
        const { stdout } = await promisify(execFile)(process.execPath, [CLI, "list"], { env, timeout: 15_000 });
        assert.deepEqual([requests, JSON.parse(stdout)], [[JSON.stringify({ list: true }) + "\n"], { ok: true, chats: [] }]);
    } finally {
        server.close();
        rmSync(home, { recursive: true, force: true });
    }
});

test("smoke: the system's check of a running Discord answers", () => {
    assert.equal(typeof system.running(), "boolean");
    if (CI) assert.equal(system.running(), false);
});

test("smoke: on CI's machine no Discord is found where the system's module looks", { skip: !CI }, () => {
    assert.equal(system.resources(), null);
});

test("smoke: on Windows the scheduled task is created and removed, and its script is valid PowerShell", { skip: !CI || process.platform !== "win32" }, () => {
    const state = mkdtempSync(join(tmpdir(), "smoke-os-"));
    const agent = { state, command: ["node", join(state, "repatch.mjs")], path: process.env.PATH ?? "", log: join(state, "it's.log"), apply: () => { } };
    try {
        system.installAgent(agent);
        assert.ok(exec("schtasks", ["/Query", "/TN", TASK], true).ok, "the task wasn't created");
        const script = join(state, "repatch-run.ps1");
        assert.ok(readFileSync(script, "utf8").includes("it''s.log"));
        const parsed = exec("powershell.exe", ["-NoProfile", "-Command", "$errors = $null; "
            + "[void][System.Management.Automation.Language.Parser]::ParseFile($env:ACB_SCRIPT, [ref]$null, [ref]$errors); "
            + "$errors | ForEach-Object { $_.Message }; exit $errors.Count"], true, { ACB_SCRIPT: script });
        assert.ok(parsed.ok, `repatch-run.ps1 doesn't parse: ${parsed.stdout}`);
    } finally {
        system.uninstallAgent(agent);
        rmSync(state, { recursive: true, force: true });
    }
    assert.ok(!exec("schtasks", ["/Query", "/TN", TASK], true).ok, "the task wasn't removed");
});
