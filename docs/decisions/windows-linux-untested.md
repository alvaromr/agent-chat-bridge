# Windows and Linux are supported, partly untested
- **Practice:** every claim verified, by running it, before it is presented as working; `pnpm live`,
  `pnpm check-discord` and a real patch for each supported system.
- **Value not at stake:** correctness on macOS, which stays verified as before. On Windows and Linux the code is
  covered by unit tests on faked systems (`test/os.test.mjs`, `test/platform.test.mjs`, `test/socket-pipe.test.mjs`)
  with 100 % coverage and mutation. What a real run checked, and what not:
  - Linux, checked on 2026-11-16 in a throwaway Debian container (x64, under emulation) with the `.deb` of Discord
    1.0.169, not logged in: Discord installs itself into `~/.config/discord/app-<version>`, which the user can write;
    `pnpm inject` and `pnpm uninject` there; the patched Discord loading `mod/`; the CLI's socket in
    `~/.config/agent-chat-bridge/`, user-only; `acb` reaching Discord through it; quitting Discord with the Linux
    module; the cache that `pnpm check-discord` reads; the module's zenity question opening, with accents, in a
    session without a locale, which first failed and is why it sets `LC_ALL` (Debian 12, zenity 3.44). Not checked:
    opening Discord with the module (inconclusive in a container without Chromium's sandbox), the answers to the
    question and the notices (no window manager or notification daemon), the systemd units, and anything that needs a
    logged-in Discord, such as `pnpm live`.
  - Windows: nothing run. Discord's paths, the named pipe, `tasklist`, `taskkill`, `Update.exe`, the PowerShell
    dialogs and the scheduled task follow their documentation.
  The README calls both systems experimental and says what was checked, so no one takes the rest for verified.
- **Why:** the owner has no Windows or Linux machine to run them on, and wanted the project usable there by the people
  it is shared with. What differs per system is kept in `scripts/os/`, `mod/src/platform.mts` and
  `plugins/shared/run.ts` (AGENTS.md, «Systems»), so a fix found by a user on those systems stays in one place.
- **Decided by:** the owner, 2026-11-16. Revisit when someone runs it on Windows or on a desktop Linux: what works
  moves to «checked», and what fails gets a regression test.
