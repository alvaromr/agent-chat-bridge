// Main-process side of the Dictation plugin, behind the dictation IPC handlers of mod/src/main.ts: the models on disk,
// and one dictation at a time, run by dictation/'s engine. Any page script can call these handlers, so the page names
// only a model the disk holds, and nothing it sends picks a binary, a path or flags.
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { Dictation } from "../../dictation/src/engine";
import { findModels, hubDir } from "../../dictation/src/models";
import { SAMPLE_RATE } from "../../dictation/src/segmenter";
import { parseReplacements, parseWords, promptFor } from "../../dictation/src/vocabulary";
import { startWorker, type Worker } from "../../dictation/src/worker";
import { IPC } from "../../mod/src/ipc";

/** main.js runs from mod/dist/. */
const DICTATION_DIR = join(__dirname, "../../dictation");
/** A worker with no dictation for this long is closed: it holds the model, ~1.6 GB. */
const IDLE_MS = 60_000;
/** The longest audio chunk the page may send: 1 s. It sends 0.1 s. */
const MAX_CHUNK = SAMPLE_RATE;
const MAX_SETTING = 4000;

/** Why a dictation doesn't start, shown in the plugin's toast. */
const TEXT = {
    invalid: "Parámetros no válidos",
    notInstalled: "El motor de dictado no está instalado: ejecuta `pnpm setup` en el repo",
    noModel: (id: string) => `El modelo ${id} no está descargado`,
    badReplacements: (lines: number[]) => `Sustituciones: las líneas ${lines.join(", ")} no tienen la forma «oído => querido»`
} as const;

export interface DictationRequest {
    model: string;
    language: string;
    vocabulary: string;
    replacements: string;
}

export type DictationStart = { ok: true; } | { ok: false; error: string; };

export type DictationEvent = { type: "partial" | "final"; text: string; } | { type: "error"; error: string; } | { type: "done"; };

export const dictationModels = (e: IpcMainEvent) => {
    e.returnValue = findModels(hubDir(process.env, homedir())).map(m => m.id);
};

let loaded: { key: string; worker: Promise<Worker>; idle: ReturnType<typeof setTimeout> | null; } | null = null;

/** The worker of this model and language, started if needed; the previous one is closed. */
function workerFor(modelPath: string, language: string) {
    const key = `${modelPath}\n${language}`;
    if (loaded?.key !== key) {
        closeWorker();
        const worker = startWorker(DICTATION_DIR, modelPath, language);
        // A failed start is reported by the transcription that waits for it; the next dictation tries again.
        worker.catch(() => {
            if (loaded?.worker === worker) loaded = null;
        });
        loaded = { key, worker, idle: null };
    }
    if (loaded.idle) clearTimeout(loaded.idle);
    loaded.idle = null;
    return loaded.worker;
}

function closeWorker() {
    if (!loaded) return;
    if (loaded.idle) clearTimeout(loaded.idle);
    // A worker that failed to start has nothing to close. Its failure reached the page if a phrase waited for it; if
    // none did, nothing was said, and the next dictation starts the worker again and meets the same failure.
    loaded.worker.then(w => w.close(), () => {});
    loaded = null;
}

function idleWorker() {
    if (loaded && !loaded.idle) loaded.idle = setTimeout(closeWorker, IDLE_MS);
}

/** The dictation the page talks to, from its start until its `done` or its cancel. */
let session: { dictation: Dictation; sender: WebContents; stopped: boolean; } | null = null;

export function startDictation(e: IpcMainInvokeEvent, req: DictationRequest): DictationStart {
    const { model: id, language, vocabulary, replacements } = req ?? {};
    if (typeof id !== "string" || typeof language !== "string" || !/^[a-z]{2,3}$/.test(language)
        || typeof vocabulary !== "string" || vocabulary.length > MAX_SETTING
        || typeof replacements !== "string" || replacements.length > MAX_SETTING)
        return { ok: false, error: TEXT.invalid };
    if (!existsSync(join(DICTATION_DIR, "worker/.venv/bin/python"))) return { ok: false, error: TEXT.notInstalled };
    const model = findModels(hubDir(process.env, homedir())).find(m => m.id === id);
    if (!model) return { ok: false, error: TEXT.noModel(id) };
    const { pairs, invalid } = parseReplacements(replacements);
    if (invalid.length) return { ok: false, error: TEXT.badReplacements(invalid) };

    cancelDictation(e);
    const worker = workerFor(model.path, language);
    const send = (event: DictationEvent) => {
        if (session === current) e.sender.send(IPC.dictationEvent, event);
    };
    const current = session = {
        sender: e.sender,
        stopped: false,
        dictation: new Dictation({ transcribe: async (samples, prompt) => (await worker).transcribe(samples, prompt) }, {
            prompt: promptFor(parseWords(vocabulary)),
            replacements: pairs,
            onPartial: text => send({ type: "partial", text }),
            onFinal: text => send({ type: "final", text }),
            onError: err => send({ type: "error", error: err instanceof Error ? err.message : String(err) })
        })
    };
    return { ok: true };
}

export function dictationAudio(e: IpcMainEvent, samples: unknown) {
    if (session?.sender !== e.sender || session.stopped || !(samples instanceof Float32Array) || samples.length > MAX_CHUNK) return;
    session.dictation.push(samples);
}

/** Ends the audio; the page gets the last finals, then `done`. */
export function stopDictation(e: IpcMainEvent) {
    if (session?.sender !== e.sender || session.stopped) return;
    const current = session;
    current.stopped = true;
    current.dictation.stop().then(() => {
        if (session !== current) return;
        session = null;
        e.sender.send(IPC.dictationEvent, { type: "done" } satisfies DictationEvent);
        idleWorker();
    });
}

/** Drops the dictation and whatever it still had to say. */
export function cancelDictation(e: IpcMainEvent | IpcMainInvokeEvent) {
    if (session?.sender !== e.sender) return;
    session.dictation.cancel();
    session = null;
    idleWorker();
}
