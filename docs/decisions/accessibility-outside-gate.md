# The accessibility checks run outside the gate
- **Practice:** gate UI commits on the accessibility checks where tooling allows.
- **Value not at stake:** the checks still run, with `pnpm a11y`, after each change to what `mod/` or the plugins show.
- **Why:** they need the running Discord with the debugging port, which needs the user's permission each time, since
  any program on the machine can read Discord while it is open.
- **Decided by:** the owner, 2026-10-30.
