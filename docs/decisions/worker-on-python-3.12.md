# The dictation worker stays on Python 3.12
- **Practice:** track the latest stable versions.
- **Value not at stake:** safety: the worker runs without network under its sandbox profile
  (`dictation/src/worker.ts`), and Python 3.12 still gets security fixes.
- **Why:** the worker installs wheels only (`no-build`), and mlx-whisper's dependencies ship no `cp315` wheels yet:
  on 2026-11-23 `mlx` stops at `cp314`. Move `requires-python` and `dictation/worker/.python-version` when this
  resolves, wheels only, for the worker's platform:
  `echo mlx-whisper==0.4.3 | uv pip compile - --python-version 3.15 --python-platform aarch64-apple-darwin --only-binary :all:`
  (with the version `pyproject.toml` pins).
- **Decided by:** the owner, 2026-11-23.
