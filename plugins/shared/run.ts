// Main-process side shared by every plugin that talks to Claude, behind the runClaude IPC handler of mod/src/main.ts.
// Any page script can call that handler, so nothing the renderer sends picks the binary, flags or tools.
import { execFile } from "child_process";
import type { IpcMainInvokeEvent } from "electron";
import { mkdtemp, rm } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";

const CLAUDE_BIN = join(homedir(), ".local/bin/claude");
const MODEL_RE = /^claude-[a-z0-9-]+$/;
const TIMEOUT_MS = 120_000;

/** Why there is no answer, shown in the plugins' toast. */
const TEXT = {
    invalid: "Parámetros no válidos",
    empty: "Respuesta vacía"
} as const;

export interface ClaudeResult {
    ok: boolean;
    text: string;
}

// No tools, MCP, CLAUDE.md, skills, hooks, memory, language setting or saved session; runs in a throwaway empty dir.
const ISOLATION_ARGS = [
    "-p", "--safe-mode", "--settings", '{"language":""}', "--tools", "", "--strict-mcp-config",
    "--no-session-persistence", "--effort", "low"
];

export async function runClaude(_: IpcMainInvokeEvent, systemPrompt: string, input: string, model: string): Promise<ClaudeResult> {
    if (typeof systemPrompt !== "string" || typeof input !== "string" || !MODEL_RE.test(model))
        return { ok: false, text: TEXT.invalid };

    const cwd = await mkdtemp(join(tmpdir(), "discord-claude-"));
    try {
        const text = await new Promise<string>((resolve, reject) => {
            const child = execFile(
                CLAUDE_BIN,
                [...ISOLATION_ARGS, "--model", model, "--system-prompt", systemPrompt],
                {
                    cwd,
                    timeout: TIMEOUT_MS,
                    maxBuffer: 1 << 20,
                    env: {
                        HOME: homedir(),
                        USER: process.env.USER,
                        PATH: "/usr/bin:/bin",
                        TMPDIR: tmpdir(),
                        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1"
                    }
                },
                (err, stdout, stderr) => err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout.trim())
            );
            // execFile always pipes stdin; without it claude would wait for input until the timeout.
            if (!child.stdin) {
                child.kill();
                return reject(new Error("claude was started without a stdin pipe"));
            }
            child.stdin.end(input);
        });
        return text ? { ok: true, text } : { ok: false, text: TEXT.empty };
    } catch (e) {
        return { ok: false, text: e instanceof Error ? e.message : String(e) };
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
}
