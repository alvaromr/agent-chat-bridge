# TypeScript stays on 6.0
- **Practice:** track the latest stable versions.
- **Value not at stake:** safety: TypeScript is a development tool, which only the release's executable ships, to
  parse Discord's cached code for `check-discord` outside Discord, never running it.
- **Why:** TypeScript 7 ships no JavaScript API, which typescript-eslint (`typescript <6.1.0`), Stryker's TypeScript
  checker and `scripts/check-discord/code.mjs` load. Move when they support it.
- **Decided by:** the owner, 2026-10-29.
