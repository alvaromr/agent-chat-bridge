# agent-chat-bridge

A bridge between an AI agent and your Discord, with you confirming everything it publishes. A minimal patch of the
official Discord desktop app for macOS, and experimentally for Windows and Linux (Requirements), adds two plugins
backed by a local `claude -p`: Corrector (spelling fixes) and Autorespuesta (reply drafts in the user's tone); Dictation, which writes what you say into the chat box with a local
Whisper model; and the `agent-chat-bridge` CLI to use Discord from Claude Code.

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
- Discord (stable), installed where each system keeps it:
  - macOS, tested: in `/Applications`.
  - Windows, experimental: Discord's own installer, under `%LOCALAPPDATA%\Discord`. Run the commands below in Git
    Bash, which comes with Git for Windows. Only checked on a machine without Discord: the CLI's connection and the
    scheduled check's task (`docs/decisions/windows-linux-untested.md`); the patch and the plugins were never run.
  - Linux, experimental: the `.deb` or the `.tar.gz`, opened once, since on its first start Discord installs itself
    into `~/.config/discord`. The patch, the plugins' loading, the CLI and the dialog opening were checked on Debian
    with Discord 1.0.169; the scheduled check was not (`docs/decisions/windows-linux-untested.md`). The dialogs need
    `zenity` and `notify-send`. Flatpak and Snap are not supported.
- Node (version in `.node-version`) and pnpm (version in `package.json`), and git.
- Claude Code installed with its native installer, as `~/.local/bin/claude` (`claude.exe` on Windows), for the plugins.
- To work on the repo (`pnpm check`): `gitleaks`, at the version in `scripts/secrets.mjs` (`brew install gitleaks` on
  a Mac), for the secret scan of the gate.
- Optional, for Dictation: a Mac with Apple Silicon and macOS 14 or later, the only ones its model's runtime
  (`mlx`) ships for; [uv](https://docs.astral.sh/uv/) (version in `dictation/worker/pyproject.toml`); a Whisper model
  in MLX format (Install); and the microphone allowed for Discord in macOS's Privacy settings. Without them the rest
  works, and Dictation shows no button.
- To work on the repo (`pnpm check`), uv on that Mac too: the gate also lints and type-checks the dictation worker.

## Install
With Discord closed, one command clones the repo at its latest release, builds it, patches Discord and installs the
dialogs that keep it patched and up to date (below):
```sh
git clone https://github.com/alvaromr/agent-chat-bridge.git && cd agent-chat-bridge \
  && git checkout "$(git describe --tags --abbrev=0)" && pnpm install --frozen-lockfile && pnpm bootstrap \
  && pnpm inject && pnpm repatch install
```
- `pnpm install --frozen-lockfile`: the dependencies, which pnpm wants installed before it runs any script.
- `pnpm bootstrap`: hooks and build; Dictation's engine where it can run, or it says why not.
- `pnpm inject`: patches Discord.
- `pnpm repatch install`: optional; drop it to re-patch and update by hand.
- `pnpm links`, optional and apart: the `agent-chat-bridge` CLI and its Claude Code skill.

For Dictation, download its model (~1.6 GB) into the Hugging Face cache with the CLI that `pnpm bootstrap` installed, then
restart Discord: Dictation looks for its engine and models when Discord starts.
```sh
dictation/worker/.venv/bin/hf download mlx-community/whisper-large-v3-turbo
```
After a Discord update, run `pnpm inject` again. With `pnpm repatch install`, a dialog offers it instead: once the new
Discord passes `pnpm check-discord`, it asks, and on a yes it quits Discord, patches it and reopens it. It asks once
per Discord version, and `pnpm repatch uninstall` removes it. It checks at login, when Discord changes and daily on
macOS (a LaunchAgent), and at login and hourly on Windows (a scheduled task) and Linux (systemd user units), where
Discord updates whenever it starts. On macOS the patch runs in a helper app, «Reparchear Discord (agent-chat-bridge)»,
that needs macOS's App Management permission: the install shows it in the Finder and opens that setting, where you
drag it in and turn it on.

## Update
With `pnpm repatch install`, a dialog offers each new release once, with what changed and which Discord it was tested
with, checked with the patch above: on a yes it installs it and reloads Discord. It only does so in a clone at a
release tag with no local changes. Without it, watch the repo on GitHub for releases only (Watch → Custom →
Releases), and install a release from the clone:
```sh
git fetch --tags && git checkout v<x.y.z>   # the new release's tag
pnpm install --frozen-lockfile              # that release's dependencies
pnpm bootstrap                              # and its build
```
Then restart Discord: the patch loads the new build on every start, so it needs no `pnpm inject`.

## Use
- Each plugin adds a button to the chat box, left of the gift icon.
- Right-click one of those buttons to open the settings at that plugin's tab. The keyboard shortcuts (Corrector's
  Enter on an empty box, Dictation's Space) each have a setting to turn them off; the buttons stay. Dictation's
  button shows only where its engine and a model are installed; elsewhere its settings tab says what is missing.
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
pnpm live       # the CLI against the running Discord, read-only (docs/debugging.md, method 4)
```

## Read next
- `AGENTS.md`: structure, commands, rules and the mandatory review.
- `docs/debugging.md`: how to verify a failure in the running Discord.
- `agent-chat-bridge --help`: the CLI.
- `CHANGELOG.md`: what changed in each release.
- `SECURITY.md`: how to report a vulnerability.

## License
GPL-3.0-or-later (`LICENSE`). `mod/` was first derived from [Vencord](https://github.com/Vendicated/Vencord), by
Vendicated and contributors, under the same license; each file that still holds derived code says so at its top.
