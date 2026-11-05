# dictation

Local dictation on Apple Silicon: live 16 kHz mono audio in, text out phrase by phrase, with a Whisper model in MLX
format that is already on disk. Nothing leaves the machine: the worker runs under a macOS sandbox profile that denies
every network connection, and every write outside the user's temporary folder, so nothing it leaves behind can reach
the network later; Hugging Face is told to stay offline.

It lives in agent-chat-bridge for the Discord plugin `plugins/dictation/`, but it knows nothing about Discord: it
imports only its own files and Node's modules (the lint enforces it), so it can move to its own repo.

## Pieces
- `src/engine.ts`: `Dictation`, one dictation. `push()` takes audio, `stop()` ends it and resolves once the last
  text is out, `cancel()` drops it. It emits `onPartial` (the open phrase so far, about every half second of audio)
  and `onFinal` (a closed phrase). It takes any `Transcriber`, so a test can give it a fake.
- `src/segmenter.ts`: splits the stream at the speaker's pauses (0.6 s), by energy over the room's noise floor, and
  drops sounds too short or too quiet to be speech. A phrase longer than 15 s is cut at its quietest point.
- `src/vocabulary.ts`: the user's words as Whisper's prompt (a sentence that names them), the check that Whisper
  didn't answer with that prompt, and the `heard => meant` replacements for what it still gets wrong.
- `src/style.ts`: `restyle()`, how the whole dictated text is written: without its final period, without the capital
  that opens each sentence (unless the vocabulary writes the word that way), without the opening `¿` and `¡`.
- `src/models.ts`: the Whisper models in the Hugging Face cache (`HF_HUB_CACHE`, `HF_HOME` or
  `~/.cache/huggingface/hub`) whose current snapshot holds `config.json` and the weights.
- `src/worker.ts`: starts the worker as a `Transcriber`.
- `worker/worker.py`: the worker, on `mlx-whisper`.

## Install
Needs [uv](https://docs.astral.sh/uv/). `uv sync --frozen --project dictation/worker` installs the worker's
packages, pinned with their hashes in `worker/uv.lock`, into `worker/.venv/`; agent-chat-bridge's `pnpm setup` does it.
Then download a model, for example `mlx-community/whisper-large-v3-turbo`, with the Hugging Face CLI.

## Use
```ts
const model = findModels(hubDir(process.env, homedir())).find(m => m.id === "mlx-community/whisper-large-v3-turbo");
const worker = await startWorker("<path to dictation/>", model.path, "es");
const dictation = new Dictation(worker, {
    prompt: promptFor(parseWords("git, commit, pull request")),
    replacements: parseReplacements("Griscord => Discord").pairs,
    onPartial: text => {}, onFinal: text => {}, onError: err => {}
});
dictation.push(samples); // Float32Array, 16 kHz mono
await dictation.stop();
worker.close();
```

## Worker
`worker.py <model folder> <language>`, one request at a time, in order:
- stdin: a JSON line `{"samples": <n>, "prompt": <string or null>}`, then n little-endian 32-bit floats.
- stdout: `{"ready": true}` once the model is loaded, then one `{"text": "…"}` per request.
- It writes neither the audio nor the text anywhere else. It ends when its stdin closes.

## Measured
On the user's voice, with the vocabulary: `whisper-large-v3-turbo` transcribes 13 s of audio in 0.3 s and makes ~7
errors in 6 test texts full of anglicisms, against ~6 for `whisper medium` (2–4 s) and ~22 for Parakeet without a
vocabulary. Loading it takes ~2 s. The splitter's thresholds come from the same recordings: speech peaks 38–42 dB over
the floor, breaths and clicks 6–23 dB.
