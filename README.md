# agent-chat-bridge

A bridge between an AI agent and your Discord, with you confirming everything it publishes. A minimal patch of the
official Discord desktop app for macOS adds two plugins backed by a local `claude -p`: Corrector (spelling fixes) and
Autorespuesta (reply drafts in the user's tone); Dictation, which writes what you say into the chat box with a local
Whisper model; and the `acb` CLI to use Discord from Claude Code.

## Before you install
- **Discord's terms:** modifying the client breaks Discord's Terms of Service, so your account is at risk.
  agent-chat-bridge keeps the risk low by never automating sends or edits (`AGENTS.md`, rule 3), but it can't remove it.
- **What leaves your machine:** the plugins send the message or the chat lines they work on to your local Claude Code
  (`claude -p`, on your subscription), which processes them on Anthropic's servers. The CLI hands what it reads to the
  Claude Code session that runs it. Dictation's audio never leaves: the model runs on your Mac, in a process denied
  the network. Nothing else sends chat content anywhere (`AGENTS.md`, rule 4).
- **Spanish:** the interface and the default prompts are in Spanish, and the Corrector's prompt targets Spanish
  spelling. Both prompts can be changed in the settings modal.
- agent-chat-bridge is not affiliated with or endorsed by Discord or Anthropic.

## Requirements
- macOS with Discord (stable) in `/Applications`.
- Node (version in `.node-version`) and pnpm (version in `package.json`).
- Homebrew's `gitleaks`, at the version in `scripts/secrets.mjs`, for the secret scan of the gate
  (`brew install gitleaks`).
- Claude Code installed as `~/.local/bin/claude`, for the plugins.
- For Dictation: Apple Silicon, [uv](https://docs.astral.sh/uv/) (version in `dictation/worker/pyproject.toml`), a
  Whisper model in MLX format in the Hugging Face cache (`mlx-community/whisper-large-v3-turbo` by default, ~1.6 GB),
  and the microphone allowed for Discord in macOS's Privacy settings.

## Install
From a clone of this repo, at its latest release tag:
```sh
pnpm setup      # hooks, dependencies, build
pnpm inject     # with Discord closed
pnpm links      # optional: the acb CLI and its Claude Code skill
```
After a Discord update, run `pnpm inject` again.

## Use
- Each plugin adds a button to the chat box, left of the gift icon.
- Right-click one of those buttons to open the settings at that plugin's tab. Each feature has its own setting to turn
  it off.
- Dictation: click the microphone, or hold Space in the chat box, as in Claude Code: the first two spaces are typed,
  and the dictation starts at the fifth press and stops when you let go. Click again, or tap Space, to stop a
  dictation started with the button; Escape drops it and puts the box back as it was. The text appears phrase by
  phrase and is never sent: you send it with Enter. Its settings pick the model among the ones on disk, the words
  Whisper should know, replacements for what it still gets wrong, and whether to drop the final period, the capital
  that opens each sentence and the opening `¿` and `¡` (dropped by default).
- Settings are saved in `~/Library/Application Support/agent-chat-bridge/settings.json`. If that file can't be read, it
  is moved aside as `settings.json.unreadable-<ms>` and a dialog says so.

## Develop
```sh
pnpm check      # the gate before each commit (AGENTS.md, «Commands»)
pnpm build      # then restart Discord
pnpm live       # what only the running Discord can show (docs/debugging.md, method 4)
```

## Read next
- `AGENTS.md`: structure, commands, rules and the mandatory review.
- `docs/debugging.md`: how to verify a failure in the running Discord.
- `acb --help`: the CLI.
- `CHANGELOG.md`: what changed in each release.
- `SECURITY.md`: how to report a vulnerability.

## License
GPL-3.0-or-later (`LICENSE`). `mod/` was first derived from [Vencord](https://github.com/Vendicated/Vencord), by
Vendicated and contributors, under the same license; each file that still holds derived code says so at its top.
