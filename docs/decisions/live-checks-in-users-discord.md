# The live checks run in the user's own Discord
- **Practice:** live checks never run in the owner's running app, account or session.
- **Value not at stake:** safety of the user's account, kept by bounding the run instead: `test/live/cli.mjs` only
  reads, through the CLI's socket; `test/live/a11y.mjs` runs only with the debugging port opened with the user's
  permission each time, closed and checked afterwards, presses Enter or Space only once the focus is on the plugin's
  button, and publishes nothing. It runs only after a Discord update, or after a change to what `mod/` or the plugins
  show or to how they read Discord, never in the gate.
- **Why:** a second Discord in the same macOS account isn't a separate session: one started with `--multi-instance`
  and its own `DISCORD_USER_DATA_DIR` opened signed in to the user's account (`docs/debugging.md`, method 4). A
  separate macOS account with a test Discord account costs more than these occasional, bounded runs.
- **Decided by:** the owner, 2026-11-06.
