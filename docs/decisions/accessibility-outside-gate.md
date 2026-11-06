# The accessibility checks in Discord run outside the gate
- **Practice:** gate UI commits on the accessibility checks where tooling allows.
- **Value not at stake:** what `mod/` renders (roles, names, labels, the tabs' keys) is checked by the gate, in the
  unit tests on a fake Discord. The contrast of what `mod/` colours, in every Discord theme, runs with
  `pnpm check-discord` on the stylesheets of Discord's cache. What Discord's running code decides (keyboard paths,
  focus rings, its modal's focus, the backgrounds it paints) still runs, with `pnpm live`, after each change to what
  `mod/` or the plugins show.
- **Why:** `pnpm check-discord` needs the Discord version the app last loaded in its cache, which the gate's clean
  checkout doesn't have; `pnpm live` needs the running Discord with the debugging port, which needs the user's
  permission each time, since any program on the machine can read Discord while it is open.
- **Decided by:** the owner, 2026-10-30; the split, 2026-11-05; the contrast to `pnpm check-discord`, 2026-11-06.
