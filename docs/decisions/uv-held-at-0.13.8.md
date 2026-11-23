# uv stays on 0.13.8 for now
- **Practice:** track the latest stable versions.
- **Value not at stake:** safety: uv is a development tool that installs the worker's packages from `uv.lock`, by
  their hashes, and 0.13.8 has no known advisory.
- **Why:** a deliberate hold, not a lag: the owner chose to wait before moving this machine's uv to 0.13.9, and
  `required-version` in `dictation/worker/pyproject.toml` and the uv pin in `scripts/build-executable.mjs` follow the
  machine's uv. Revisit at the next dependency update, or sooner if an advisory affects 0.13.8.
- **Decided by:** the owner, 2026-11-23.
