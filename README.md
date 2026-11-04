# discord-mod

The official Discord desktop app for macOS with a minimal own patch that adds two plugins backed by a local
`claude -p`: Corrector (spelling fixes) and Autorespuesta (reply drafts in the user's tone), plus the `discord-mod`
CLI to use Discord from Claude Code.

## Before you install
- **Discord's terms:** modifying the client breaks Discord's Terms of Service, so your account is at risk.
  discord-mod keeps the risk low by never automating sends or edits (`AGENTS.md`, rule 3), but it can't remove it.
- **What leaves your machine:** the plugins send the message or the chat lines they work on to your local Claude Code
  (`claude -p`, on your subscription), which processes them on Anthropic's servers. The CLI hands what it reads to the
  Claude Code session that runs it. Nothing else sends chat content anywhere (`AGENTS.md`, rule 4).
- **Spanish:** the interface and the default prompts are in Spanish, and the Corrector's prompt targets Spanish
  spelling. Both prompts can be changed in the settings modal.
- discord-mod is not affiliated with or endorsed by Discord or Anthropic.

## Requirements
- macOS with Discord (stable) in `/Applications`.
- Node (version in `.node-version`) and pnpm (version in `package.json`).
- Homebrew's `gitleaks`, at the version in `scripts/secrets.mjs`, for the secret scan of the gate
  (`brew install gitleaks`).
- Claude Code installed as `~/.local/bin/claude`, for the plugins.

## Install
From a clone of this repo, at its latest release tag:
```sh
pnpm setup      # hooks, dependencies, build
pnpm inject     # with Discord closed
pnpm links      # optional: the discord-mod CLI and its Claude Code skill
```
After a Discord update, run `pnpm inject` again.

## Use
- Each plugin adds a button to the chat box, left of the gift icon.
- Right-click one of those buttons to open the settings of both plugins. Each feature has its own setting to turn it
  off.
- Settings are saved in `~/Library/Application Support/discord-mod/settings.json`. If that file can't be read, it is
  moved aside as `settings.json.unreadable-<ms>` and a dialog says so.

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
- `CHANGELOG.md`: what changed in each release.
- `SECURITY.md`: how to report a vulnerability.

## License
GPL-3.0-or-later (`LICENSE`). `mod/` was first derived from [Vencord](https://github.com/Vendicated/Vencord), by
Vendicated and contributors, under the same license; each file that still holds derived code says so at its top.
