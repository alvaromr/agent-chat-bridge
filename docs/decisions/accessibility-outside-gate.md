# The accessibility checks in Discord run outside the gate
- **Practice:** gate UI commits on the accessibility checks where tooling allows.
- **Value not at stake:** what `mod/` renders (roles, names, labels, the tabs' keys) is checked by the gate, in the
  unit tests on a fake Discord. What Discord's own components and colours decide (keyboard paths, focus rings, its
  modal's focus, contrast) still runs, with `pnpm live`, after each change to what `mod/` or the plugins show.
- **Why:** that part needs the running Discord with the debugging port, which needs the user's permission each time,
  since any program on the machine can read Discord while it is open.
- **Decided by:** the owner, 2026-10-30; the split, 2026-11-05.
