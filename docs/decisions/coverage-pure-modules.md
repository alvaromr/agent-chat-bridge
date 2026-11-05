# Coverage covers the pure modules only
- **Practice:** 100 % coverage of the whole code base.
- **Value not at stake:** correctness through unit coverage, for code that only runs inside Discord. Its correctness
  is checked by other means: `pnpm smoke`, `pnpm check-discord`, the methods of `docs/debugging.md`, and a regression
  test on a fake Discord for each fix there.
- **Why:** the rest of `mod/` and `plugins/` needs Discord's webpack modules and Electron, which a unit test can only
  fake, and a fake proves the code's logic, not that Discord still behaves as faked. The coverage counts the pure
  modules, the `mutate` list of `stryker.config.mjs`, so a regression test may load Discord-side code without counting
  it. The CLI's socket side is excluded in place, with that reason. The scripts that are only I/O stay out and are
  checked by running them: `scripts/inject.mjs` (`pnpm inject`), `scripts/release.mjs` (`pnpm release`),
  `scripts/secrets.mjs` (`pnpm check`), `scripts/cdp.mjs`, `scripts/a11y.mjs` and `scripts/devtools.mjs`
  (`docs/debugging.md`) and `mod/build.mjs` (`pnpm build`). So does the dictation worker, `dictation/worker/worker.py`,
  a loop that hands each request to `mlx-whisper`, checked by `pnpm smoke-dictation`; the module that starts it,
  `dictation/src/worker.ts`, is covered like the pure modules, on a faked child process.
- **Decided by:** the owner, 2026-10-29; the dictation worker, 2026-11-05.
