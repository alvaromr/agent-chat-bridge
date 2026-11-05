# Coverage leaves out the scripts that are only I/O, and the worker
- **Practice:** 100 % coverage of the whole code base.
- **Value not at stake:** correctness through unit coverage. All of `mod/`, `plugins/` and `dictation/src/` is
  covered, on a fake Discord where it touches Discord, and so is the CLI; `pnpm live` checks what only the real
  Discord decides, and `pnpm check-discord` that its code still has what the fake stands for.
- **Why:** what stays out is only I/O, checked by running it, where a unit test would fake all it does:
  `scripts/inject.mjs` (`pnpm inject`), `scripts/release.mjs` (`pnpm release`), `scripts/secrets.mjs` (`pnpm check`),
  `scripts/cdp.mjs` and `scripts/devtools.mjs` (`docs/debugging.md`) and `mod/build.mjs` (`pnpm build`); and the
  dictation worker, `dictation/worker/worker.py`, a loop that hands each request to `mlx-whisper`, checked by
  `pnpm smoke-dictation`. In the CLI, only the line that runs it as a command is excluded in place, with that reason.
- **Decided by:** the owner, 2026-10-29; the dictation worker, 2026-11-05; everything else covered, 2026-11-05.
