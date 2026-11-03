# Lint and types allow `any`
- **Practice:** strictest types, no `any`, and a type-aware lint.
- **Value not at stake:** correctness through types, for Discord's internals: they are untyped, so a type there would be
  a guess, not a check.
- **Why:** `no-explicit-any` is off, `noImplicitAny` is false and the lint is not type-aware. `discordTypes.ts` types
  only the members the code uses.
- **Decided by:** the owner, 2026-10-29.
