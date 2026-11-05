"""Transcribes phrases for dictation/src/worker.ts, over the protocol in dictation/README.md («Worker»).

Usage: worker.py <model folder> <language>. Writes nothing but the answers to stdout, and neither the audio nor the
text anywhere else.
"""

import json
import sys

import mlx_whisper
import numpy as np

SAMPLE_RATE = 16000


def main() -> None:
    model, language = sys.argv[1], sys.argv[2]

    def transcribe(audio: np.ndarray, prompt: str | None) -> dict:
        result = mlx_whisper.transcribe(
            audio, path_or_hf_repo=model, language=language, initial_prompt=prompt, verbose=None
        )
        return {"text": result["text"].strip()}

    # Loads the model before saying it is ready, so the first phrase doesn't wait for it.
    transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), None)
    answer({"ready": True})

    stdin = sys.stdin.buffer
    while header := stdin.readline():
        request = json.loads(header)
        size = request["samples"] * 4
        data = stdin.read(size)
        if len(data) != size:
            message = f"expected {size} bytes of audio, got {len(data)}"
            raise EOFError(message)
        answer(transcribe(np.frombuffer(data, dtype="<f4"), request["prompt"]))


def answer(message: dict) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
