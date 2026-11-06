# The live checks run in the user's own Discord
- **Practice:** live checks never run in the owner's running app, account or session.
- **Value not at stake:** safety of the user's account: `test/live/cli.mjs` only reads, through the CLI's socket of
  the Discord already open, prints no chat names or messages, and publishes nothing. It needs no debugging port and
  presses no keys. It runs only after a Discord update, or after a change to how `mod/` reads Discord, never in the
  gate.
- **Why:** a second Discord in the same macOS account isn't a separate session: one started with `--multi-instance`
  and its own `DISCORD_USER_DATA_DIR` opened signed in to the user's account (`docs/debugging.md`, method 4). A
  separate macOS account with a test Discord account costs more than these occasional read-only runs.
- **Decided by:** the owner, 2026-11-06.
