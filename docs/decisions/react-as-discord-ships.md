# React stays on the version Discord ships
- **Practice:** track the latest stable versions.
- **Value not at stake:** safety: `react`, `react-dom` and their types are development dependencies that only the
  tests load; the plugins render on Discord's own React (`mod/src/plugin-api/jsx.ts`), and nothing from them reaches
  Discord.
- **Why:** `test/fake-discord.mjs` stands in for Discord with the React Discord ships, so the tests render the plugins
  as Discord does. On 2026-11-23 Discord's cached code reports React 19.2.3 (its `version` and `reconcilerVersion`),
  the version `package.json` pins, while React's latest is 19.3.1. Move `react`, `react-dom` and `@types/react-dom`
  when Discord moves.
- **Decided by:** the owner, 2026-11-23.
