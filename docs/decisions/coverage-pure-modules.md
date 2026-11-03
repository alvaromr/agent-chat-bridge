# Coverage covers the pure modules only
- **Practice:** 100 % coverage of the whole code base.
- **Value not at stake:** correctness through unit coverage, for code that only runs inside Discord. Its correctness
  is checked by other means: `pnpm smoke`, `pnpm check-discord` and the methods of `docs/debugging.md`.
- **Why:** the rest of `mod/` and `plugins/` needs Discord's webpack modules and Electron, which no unit test can
  load. The CLI's socket side is excluded in place, with that reason. The coverage counts only the files the tests
  load, so the scripts that are only I/O stay out of it and are checked by running them: `scripts/inject.mjs`
  (`pnpm inject`), `scripts/secrets.mjs` (`pnpm check`), `scripts/cdp.mjs`, `scripts/a11y.mjs` and
  `scripts/devtools.mjs` (`docs/debugging.md`) and `mod/build.mjs` (`pnpm build`).
- **Decided by:** the owner, 2026-11-03.
