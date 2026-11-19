# agent-chat-bridge

A bridge between an AI agent and your Discord, with you confirming everything it publishes. A minimal patch of the
official Discord desktop app for macOS, and experimentally for Windows and Linux (Requirements), adds two plugins
backed by a local `claude -p`: Corrector (spelling fixes) and Autorespuesta (reply drafts in the user's tone); Dictation, which writes what you say into the chat box with a local
Whisper model; and the `agent-chat-bridge` CLI to use Discord from Claude Code.

## Highlights
- **Claude reads your chats and answers for you.** Ask Claude Code what's new on Discord, to sum up a chat or to
  answer someone: it reads the chats Discord has loaded, leaves the reply ready in the chat box, and sends it only when
  you confirm. In the chats you choose, for one session, it can reply on its own, its messages marked as Claude's
  (`skills/agent-chat-bridge/SKILL.md`, «Auto-reply»). Autorespuesta drafts a reply in your tone from the chat box.
- **Dictate holding Space.** Hold Space in the chat box and speak, as in Claude Code: the text appears phrase by
  phrase and you send it yourself. The model runs on your Mac, and the audio never leaves it (Apple Silicon only).
- **Fix typos with Claude.** The Corrector fixes spelling, accents, misplaced spaces and chat abbreviations in your
  message, or in the last one you sent with Enter on an empty box; a correction that changes your words waits for you
  to review it.

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
  - Windows, experimental: Discord's own installer, under `%LOCALAPPDATA%\Discord`. Only checked on a machine without
    Discord: the CLI's connection and the scheduled check's task (`docs/decisions/windows-linux-untested.md`); the
    patch and the plugins were never run.
  - Linux, experimental: the `.deb` or the `.tar.gz`, opened once, since on its first start Discord installs itself
    into `~/.config/discord`. The patch, the plugins' loading, the CLI and the dialog opening were checked on Debian
    with Discord 1.0.169; the scheduled check was not (`docs/decisions/windows-linux-untested.md`). The dialogs need
    `zenity` and `notify-send`, and the executable `pgrep` and `libatomic1`, which desktop systems have. Flatpak and
    Snap are not supported.
- Claude Code installed with its native installer, as `~/.local/bin/claude` (`claude.exe` on Windows), for the plugins,
  with `~/.local/bin` on the PATH, as that installer offers.
- On macOS, the App Management permission for the terminal you install from (System Settings → Privacy & Security →
  App Management), which macOS asks for before a program changes another app.
- Optional, for Dictation: a Mac with Apple Silicon and macOS 14 or later, the only ones its model's runtime
  (`mlx`) ships for, and the microphone allowed for Discord in macOS's Privacy settings. Without them the rest works,
  and Dictation shows no button.

Nothing else: the release's executable carries what it runs. To work on the repo, see «Develop».

## Install
Ask Claude Code to install agent-chat-bridge from this README, or do it by hand: download your system's executable from
the [latest release](https://github.com/alvaromr/agent-chat-bridge/releases/latest) into `~/.local/bin/`, then, with
Discord closed, run its `install`. Each release has one executable per system:

| System | File |
|---|---|
| macOS, Apple Silicon | `agent-chat-bridge-darwin-arm64` |
| macOS, Intel | `agent-chat-bridge-darwin-x64` |
| Linux, x64 | `agent-chat-bridge-linux-x64` |
| Windows, x64 | `agent-chat-bridge-win-x64.exe` |

On macOS and Linux (here for Apple Silicon; change the file for yours):
```sh
mkdir -p ~/.local/bin && curl -fL -o ~/.local/bin/agent-chat-bridge \
  https://github.com/alvaromr/agent-chat-bridge/releases/latest/download/agent-chat-bridge-darwin-arm64 \
  && chmod +x ~/.local/bin/agent-chat-bridge && agent-chat-bridge install --dictation
```
On Windows, in PowerShell:
```powershell
New-Item -ItemType Directory -Force "$HOME\.local\bin" | Out-Null
Invoke-WebRequest -OutFile "$HOME\.local\bin\agent-chat-bridge.exe" `
  https://github.com/alvaromr/agent-chat-bridge/releases/latest/download/agent-chat-bridge-win-x64.exe
& "$HOME\.local\bin\agent-chat-bridge.exe" install
```
- Download it with the terminal, as above, not with the browser: Apple and Microsoft haven't signed it, so macOS
  blocks, and Windows warns about, an executable a browser downloaded. The first download is checked only by HTTPS;
  every update after it, by the release's signature (below).
- `install` puts its files in agent-chat-bridge's app folder, the Claude Code skill in `~/.claude/skills/`, patches
  Discord and schedules the check that keeps it patched and up to date (below). `--dictation`, only on a Mac with
  Apple Silicon, also installs Dictation's engine and model, about 2.2 GB; drop it to install without Dictation. It
  downloads before it patches, so Discord can stay open until then; run `install` again to finish once it is closed.
- On macOS the patch needs the App Management permission (Requirements), and the scheduled re-patch runs in a helper
  app, «Reparchear Discord (agent-chat-bridge)», that needs it too: the install shows it in the Finder and opens that
  setting, where you drag it in and turn it on.

After a Discord update, the patch is gone. A dialog then offers to patch it again: once the new Discord passes
`agent-chat-bridge check-discord`, it asks, and on a yes it quits Discord, patches it and reopens it. It asks once per
Discord version. It checks at login, when Discord changes and daily on macOS (a LaunchAgent), and at login and hourly
on Windows (a scheduled task) and Linux (systemd user units), where Discord updates whenever it starts. By hand,
`agent-chat-bridge inject` patches it, with Discord closed.

## Update
The same check offers each new release once, with what changed and which Discord it was tested with: on a yes it
downloads your system's executable, installs it only if the release's signature is valid, and reloads Discord. By
hand, download the new executable as in «Install» and run `agent-chat-bridge install` again.

## Uninstall
`agent-chat-bridge uninstall` removes the scheduled check, the patch, the skill and the files, Dictation's engine
included; your settings stay in the app folder, and Dictation's model in the Hugging Face cache. Then delete the
executable, as it says.

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
A clone runs agent-chat-bridge from its own files, built on your machine. It needs Node (version in `.node-version`),
pnpm (version in `package.json`) and git; for the gate (`pnpm check`), `gitleaks` at the version in
`scripts/secrets.mjs` (`brew install gitleaks` on a Mac) and, on an Apple Silicon Mac, [uv](https://docs.astral.sh/uv/)
(version in `dictation/worker/pyproject.toml`), which also installs Dictation's engine. On Windows, run the commands
in Git Bash. With Discord closed:
```sh
git clone https://github.com/alvaromr/agent-chat-bridge.git && cd agent-chat-bridge \
  && pnpm install --frozen-lockfile && pnpm bootstrap && pnpm inject && pnpm repatch install && pnpm links
dictation/worker/.venv/bin/hf download mlx-community/whisper-large-v3-turbo   # Dictation's model, ~1.6 GB
```
`pnpm bootstrap` sets the hooks, builds and installs Dictation's engine where it can run; `pnpm links` links the CLI
into `~/.local/bin/` and its skill into `~/.claude/skills/`. A clone checked out at a release tag, with no local
changes, is offered each new release's tag; a development clone is never updated.
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
