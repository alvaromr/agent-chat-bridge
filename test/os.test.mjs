// The Windows and Linux sides of the scripts (scripts/os/win32.mjs, scripts/os/linux.mjs) and how every system runs a
// command (scripts/os/exec.mjs), with the machine faked: the commands run and what each answers, Discord's folders,
// and a temporary home. What a real run checked, and what not, is in docs/decisions/windows-linux-untested.md. macOS's side is in
// test/repatch.test.mjs. Run with `pnpm test`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, test, vi } from "vitest";

const REPO = fileURLToPath(new URL("..", import.meta.url));

/** The machine: what each command answers, Discord's folders, and every command run with the text it was given. @type {any} */
const machine = vi.hoisted(() => ({}));
vi.mock("node:os", async original => ({ ...(/** @type {any} */ (await original())), homedir: () => machine.home }));
vi.mock("node:child_process", () => ({
    execFileSync: () => { },
    spawnSync: (command, args, options) => {
        const line = [command, ...args].join(" ");
        machine.runs.push(line);
        if (options.stdio === "pipe") machine.piped.push(command);
        if (options.env?.ACB_TEXT !== undefined) machine.texts.push(options.env.ACB_TEXT);
        if (options.env?.LC_ALL !== undefined) machine.locales.push(options.env.LC_ALL);
        const ok = machine.answers[line] ?? machine.answers[command] ?? machine.answers[`${command} ${args[0]}`] ?? true;
        return { status: ok ? 0 : 1, stdout: options.stdio === "pipe" ? machine.stdout[command] ?? "" : null, stderr: options.stdio === "pipe" ? "why\n" : null };
    }
}));
vi.mock("node:fs", async original => {
    const fs = /** @type {any} */ (await original());
    return {
        ...fs,
        existsSync: path => machine.folders.has(path) || fs.existsSync(path),
        readdirSync: path => machine.folders.get(path) ?? fs.readdirSync(path)
    };
});

let home;
beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "os-"));
    Object.assign(machine, { home, runs: [], piped: [], texts: [], locales: [], answers: {}, stdout: {}, folders: new Map() });
    vi.stubEnv("LOCALAPPDATA", join(home, "Local"));
    vi.stubEnv("XDG_CONFIG_HOME", join(home, "config"));
    vi.resetModules();
});
afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
});

/** What an install hands the system: its state folder, the check's command, the PATH and the log. */
const agent = (command = ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "/repo/scripts/repatch.mjs"]) => {
    const state = join(home, "state");
    mkdirSync(state, { recursive: true });
    return { state, command, path: "/bin:/it's", log: join(state, "repatch.log"), apply: () => machine.runs.push("apply") };
};
/** The release's executable, which has no clone: the check runs its `repatch`, from no folder in particular. */
const asExecutable = () => vi.doMock("node:sea", () => ({ isSea: () => true, getAsset: () => "[]" }));
afterEach(() => void vi.doUnmock("node:sea"));

const win32 = () => import("../scripts/os/win32.mjs");
const linux = () => import("../scripts/os/linux.mjs");

test("exec: added variables join the script's own, and a failed command whose output is read fails with its error", async () => {
    const { exec, output } = await import("../scripts/os/exec.mjs");
    exec("powershell.exe", ["x"], true, { ACB_TEXT: "hola" });
    assert.deepEqual(machine.texts, ["hola"]);
    machine.answers.git = false;
    assert.throws(() => output("git", ["status"]), { message: "git failed: why" });
});

test("win32: Discord's resources are the newest app folder's, by version, or none without one", async () => {
    const discord = join(home, "Local", "Discord");
    const { resources } = await win32();
    assert.equal(resources(), null);
    machine.folders.set(discord, ["packages", "Update.exe", "app-1.0.9"]);
    assert.equal(resources(), join(discord, "app-1.0.9", "resources"));
    /** @type {[string[], string][]} */
    const cases = [
        [["app-1.0.9", "app-1.0.10", "app-0.9.99", "app-1.0"], "app-1.0.10"], [["app-1.9.0", "app-1.10.0"], "app-1.10.0"],
        [["app-9.0.0", "app-10.0.0"], "app-10.0.0"], [["app-1.0.0", "xapp-9.9.9", "app-9.9.9x"], "app-1.0.0"]
    ];
    for (const [apps, newest] of cases) {
        machine.folders.set(discord, apps);
        assert.equal(resources(), join(discord, newest, "resources"), apps.join(" "));
    }
    machine.folders.set(discord, ["packages"]);
    assert.equal(resources(), null);
});

test("win32: without LOCALAPPDATA, Discord is looked for under the user's AppData\\Local", async () => {
    vi.stubEnv("LOCALAPPDATA", undefined);
    const discord = join(home, "AppData", "Local", "Discord");
    machine.folders.set(discord, ["app-1.0.0"]);
    assert.equal((await win32()).resources(), join(discord, "app-1.0.0", "resources"));
});

test("win32: pnpm runs through cmd.exe, Discord is ended and started through Update.exe, and tasklist says whether it runs", async () => {
    const system = await win32();
    assert.deepEqual(system.pnpm(["inject"]), ["cmd.exe", ["/d", "/c", "pnpm", "inject"]]);
    machine.stdout.tasklist = "Discord.exe   1234 Console   1   120.000 K\n";
    assert.equal(system.running(), true);
    machine.stdout.tasklist = "INFO: No tasks are running which match the specified criteria.\n";
    assert.equal(system.running(), false);
    system.quit();
    system.open();
    assert.deepEqual(machine.runs, [...Array(2).fill("tasklist /FI IMAGENAME eq Discord.exe /NH"), "taskkill /IM Discord.exe /F",
        `${join(home, "Local", "Discord", "Update.exe")} --processStart Discord.exe`]);
    assert.deepEqual(machine.piped, ["tasklist", "tasklist"]);
    assert.equal(system.logFile("C:\\s"), join("C:\\s", "repatch.log"));
    assert.equal(system.permissionHint, "");
});

test("win32: notices and questions are message boxes, the text passed apart from the command; the question names the choice", async () => {
    const system = await win32();
    system.notify("hecho");
    assert.deepEqual(system.ask("¿Parcheo?", "Cerrar y parchear"), { ok: true, reason: "" });
    machine.answers["powershell.exe"] = false;
    assert.deepEqual(system.ask("¿Parcheo?", "Cerrar y parchear"), { ok: false, reason: "No" });
    assert.deepEqual(machine.texts, ["hecho", "¿Parcheo?\n\nCerrar y parchear?", "¿Parcheo?\n\nCerrar y parchear?"]);
    const box = buttons => "powershell.exe -NoProfile -Command Add-Type -AssemblyName System.Windows.Forms; if ([System.Windows.Forms.MessageBox]::Show("
        + `$env:ACB_TEXT, 'agent-chat-bridge', '${buttons}') -in 'OK','Yes') { exit 0 } else { exit 1 }`;
    assert.deepEqual(machine.runs, [box("OK"), box("YesNo"), box("YesNo")]);
    assert.deepEqual(machine.piped, Array(3).fill("powershell.exe"));
});

test("win32: apply runs at once; install writes the script and an hourly hidden task; uninstall removes both", async () => {
    const system = await win32();
    const a = agent();
    system.runApply(a);
    assert.deepEqual(system.installAgent(a), []);
    const run = join(a.state, "repatch-run.ps1");
    assert.equal(readFileSync(run, "utf8"), `Set-Location '${REPO}'\n$env:PATH = '/bin:/it''s'\n`
        + `& 'node' '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON' '/repo/scripts/repatch.mjs' 'run' *>> '${a.log}'\n`);
    assert.deepEqual(system.uninstallAgent(a), []);
    assert.equal(existsSync(run), false);
    assert.deepEqual(machine.runs, ["apply",
        `schtasks /Create /F /SC HOURLY /TN agent-chat-bridge-repatch /TR powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${run}"`,
        "schtasks /Query /TN agent-chat-bridge-repatch", "schtasks /Delete /F /TN agent-chat-bridge-repatch"]);
    assert.deepEqual(machine.piped, ["schtasks"]);
    assert.deepEqual(system.uninstallAgent(a), [], "nothing left to remove is no error");
});

test("win32: from the executable, the task's script runs its repatch command, from no clone", async () => {
    asExecutable();
    const a = agent(["C:\\bin\\agent-chat-bridge.exe", "repatch"]);
    (await win32()).installAgent(a);
    assert.equal(readFileSync(join(a.state, "repatch-run.ps1"), "utf8"),
        `$env:PATH = '/bin:/it''s'\n& 'C:\\bin\\agent-chat-bridge.exe' 'repatch' 'run' *>> '${a.log}'\n`);
});

test("win32: install and uninstall fail when schtasks can't create or delete the task; a missing one needs no delete", async () => {
    const system = await win32();
    machine.answers["schtasks /Create"] = false;
    assert.throws(() => system.installAgent(agent()), { message: "schtasks couldn't create agent-chat-bridge-repatch" });
    machine.answers["schtasks /Delete"] = false;
    assert.throws(() => system.uninstallAgent(agent()), { message: "schtasks couldn't delete agent-chat-bridge-repatch" });
    machine.answers["schtasks /Query"] = false;
    machine.runs = [];
    assert.deepEqual(system.uninstallAgent(agent()), []);
    assert.deepEqual(machine.runs, ["schtasks /Query /TN agent-chat-bridge-repatch"]);
});

test("linux: the units go under ~/.config without XDG_CONFIG_HOME, and a session's variables that aren't set stay out", async () => {
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
    for (const name of ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) vi.stubEnv(name, "");
    const a = agent();
    (await linux()).installAgent(a);
    assert.equal(existsSync(join(home, ".config", "systemd", "user", "agent-chat-bridge-repatch.timer")), true);
    assert.match(readFileSync(join(a.state, "repatch-run.sh"), "utf8"), / PATH='\/bin:\/it'\\''s' exec 'node' /);
});

test("linux: Discord's resources are the newest app folder's in ~/.config/discord, where Discord installs itself", async () => {
    const { resources } = await linux();
    assert.equal(resources(), null, "before Discord's first start");
    const discord = join(home, "config", "discord");
    machine.folders.set(discord, ["Cache", "Discord", "1.0.169", "app-1.0.168", "app-1.0.169"]);
    assert.equal(resources(), join(discord, "app-1.0.169", "resources"));
});

test("linux: Discord is ended with pkill and started detached; notices and questions are notify-send and zenity", async () => {
    const system = await linux();
    system.quit();
    system.open();
    system.notify("hecho");
    assert.deepEqual(system.ask("¿Parcheo?", "Cerrar y parchear", "Ahora no"), { ok: true, reason: "why" });
    machine.answers.zenity = false;
    assert.equal(system.ask("¿Parcheo?", "Cerrar y parchear", "Ahora no").ok, false);
    assert.deepEqual(machine.runs.slice(0, 4), ["pkill -x Discord", "sh -c setsid -f discord >/dev/null 2>&1", "notify-send agent-chat-bridge hecho",
        "zenity --question --title=agent-chat-bridge --text=¿Parcheo? --ok-label=Cerrar y parchear --cancel-label=Ahora no --no-markup"]);
    assert.deepEqual(machine.locales, ["C.UTF-8", "C.UTF-8", "C.UTF-8"], "the desktop tools read accents in any session");
    assert.deepEqual(machine.piped, ["zenity", "zenity"], "only the answer is read; a notice's output goes to the log");
    assert.equal(system.logFile("/s"), join("/s", "repatch.log"));
    assert.equal(system.permissionHint, "");
});

test("linux: the user can write their own Discord folder, so apply runs at once, and pnpm runs as it is", async () => {
    const system = await linux();
    assert.deepEqual(system.pnpm(["inject"]), ["pnpm", ["inject"]]);
    system.runApply(agent());
    assert.deepEqual(machine.runs, ["apply"]);
});

test("linux: install writes the script, with the desktop session dialogs need, and the units, and enables them", async () => {
    vi.stubEnv("DISPLAY", ":0");
    vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
    vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus");
    vi.stubEnv("XDG_RUNTIME_DIR", "/run/user/1000");
    const system = await linux();
    const a = agent();
    assert.deepEqual(system.installAgent(a), []);
    assert.equal(readFileSync(join(a.state, "repatch-run.sh"), "utf8"), `cd '${REPO}' && PATH='/bin:/it'\\''s' DISPLAY=':0' WAYLAND_DISPLAY='wayland-0' `
        + "XDG_RUNTIME_DIR='/run/user/1000' DBUS_SESSION_BUS_ADDRESS='unix:path=/run/user/1000/bus' exec 'node' "
        + `'--disable-warning=MODULE_TYPELESS_PACKAGE_JSON' '/repo/scripts/repatch.mjs' 'run' >> '${a.log}' 2>&1\n`);
    const units = join(home, "config", "systemd", "user");
    assert.equal(readFileSync(join(units, "agent-chat-bridge-repatch.service"), "utf8"), "[Unit]\nDescription=agent-chat-bridge: re-patch "
        + `Discord and offer new releases\n\n[Service]\nType=oneshot\nExecStart=/bin/sh '${join(a.state, "repatch-run.sh")}'\n`);
    assert.equal(readFileSync(join(units, "agent-chat-bridge-repatch.timer"), "utf8"), "[Unit]\nDescription=agent-chat-bridge: hourly check\n\n"
        + "[Timer]\nOnStartupSec=2min\nOnUnitActiveSec=1h\n\n[Install]\nWantedBy=timers.target\n");
    assert.deepEqual(machine.runs, ["systemctl --user daemon-reload", "systemctl --user enable --now agent-chat-bridge-repatch.timer"]);
});

test("linux: from the executable, the script runs its repatch command, from no clone", async () => {
    vi.stubEnv("DISPLAY", "");
    asExecutable();
    const a = agent(["/home/u/.local/bin/agent-chat-bridge", "repatch"]);
    (await linux()).installAgent(a);
    assert.match(readFileSync(join(a.state, "repatch-run.sh"), "utf8"), /^PATH='\/bin:\/it'\\''s' (\w+='[^']*' )*exec '\/home\/u\/.local\/bin\/agent-chat-bridge' 'repatch' 'run' >> /);
});

test("linux: install fails when systemctl does; uninstall disables and removes the units and the script", async () => {
    const system = await linux();
    const a = agent();
    machine.answers["systemctl --user enable --now agent-chat-bridge-repatch.timer"] = false;
    assert.throws(() => system.installAgent(a), { message: "systemctl --user enable --now agent-chat-bridge-repatch.timer failed" });
    machine.runs = [];
    assert.deepEqual(system.uninstallAgent(a), []);
    assert.deepEqual(system.uninstallAgent(a), [], "nothing left to remove is no error");
    const units = join(home, "config", "systemd", "user");
    assert.deepEqual(["service", "timer"].map(name => join(units, `agent-chat-bridge-repatch.${name}`)).concat(join(a.state, "repatch-run.sh")).filter(existsSync), []);
    assert.deepEqual(machine.runs, Array(2).fill(["systemctl --user disable --now agent-chat-bridge-repatch.timer", "systemctl --user daemon-reload"]).flat());
});
