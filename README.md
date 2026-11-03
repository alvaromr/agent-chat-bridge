# discord-mod

The official Discord desktop app for macOS with a minimal own patch that adds two plugins backed by a local
`claude -p`: Corrector (spelling fixes) and Autorespuesta (reply drafts in the user's tone), plus the `discord-mod`
CLI to use Discord from Claude Code.

## Requirements
- macOS with Discord (stable) in `/Applications`.
- Node (version in `.node-version`) and pnpm (version in `package.json`).
- Homebrew's `gitleaks`, at the version in `scripts/secrets.mjs`, for the secret scan of the gate
  (`brew install gitleaks`).
- Claude Code installed as `~/.local/bin/claude`, for the plugins.

## Install
```sh
pnpm setup      # hooks, dependencies, build
pnpm inject     # with Discord closed
pnpm links      # optional: the discord-mod CLI and its Claude Code skill
```
After a Discord update, run `pnpm inject` again.

## Develop
```sh
pnpm check      # the gate before each commit (AGENTS.md, «Commands»)
pnpm build      # then restart Discord
pnpm smoke      # read-only checks against the running Discord
```

## Read next
- `AGENTS.md`: structure, commands, rules and the mandatory review.
- `docs/debugging.md`: how to verify a failure in the running Discord.
- `discord-mod --help`: the CLI.

## License
GPL-3.0-or-later (`LICENSE`). `mod/` was first derived from [Vencord](https://github.com/Vendicated/Vencord), by
Vendicated and contributors, under the same license; each file that still holds derived code says so at its top.
