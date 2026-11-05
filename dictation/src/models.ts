// The Whisper models already downloaded in MLX format: the folders of the Hugging Face cache that hold one whole.
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export interface Model {
    /** As Hugging Face names it: `mlx-community/whisper-large-v3-turbo`. */
    id: string;
    /** The snapshot folder that holds its config and weights. */
    path: string;
}

/** Where Hugging Face keeps its cache, by its own environment variables. */
export function hubDir(env: Record<string, string | undefined>, home: string): string {
    return env.HF_HUB_CACHE ?? join(env.HF_HOME ?? join(home, ".cache/huggingface"), "hub");
}

const CACHE_DIR = /^models--([^-][\w.-]*?)--(.*whisper.*)/i;
const WEIGHTS = ["weights.safetensors", "weights.npz"];

/**
 * Whisper models whose current snapshot (the one `refs/main` names, as Hugging Face keeps it) holds `config.json`
 * and the weights, sorted by id.
 */
export function findModels(hub: string): Model[] {
    if (!existsSync(hub)) return [];
    const models: Model[] = [];
    for (const dir of readdirSync(hub)) {
        const match = CACHE_DIR.exec(dir);
        const ref = join(hub, dir, "refs/main");
        if (!match || !existsSync(ref)) continue;
        const path = join(hub, dir, "snapshots", readFileSync(ref, "utf8").trim());
        if (existsSync(join(path, "config.json")) && WEIGHTS.some(w => existsSync(join(path, w)))) models.push({ id: `${match[1]}/${match[2]}`, path });
    }
    return models.sort((a, b) => a.id.localeCompare(b.id));
}
