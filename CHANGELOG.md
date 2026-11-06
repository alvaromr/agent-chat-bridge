# Changelog
What changes for whoever installs agent-chat-bridge, per version. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [SemVer](https://semver.org/):
`pnpm release` moves the entries under `[Unreleased]` to the new version.

## [Unreleased]

### Added
- Dictation: dictate into the chat box with a local Whisper model, with the microphone button or by holding Space as
  in Claude Code. The text appears phrase by phrase and is never sent. Its settings pick the model among the ones on
  disk, the words it should know, replacements for what it still mishears, and whether to drop the final period, the
  capital that opens each sentence and the opening `¿` and `¡` (dropped by default). It needs an Apple Silicon Mac
  with macOS 14 or later, uv and a downloaded model (README, «Install»): `pnpm setup` installs its engine only there
  and says why elsewhere, and without engine or model Dictation shows no button and its settings tab says what is missing.

### Changed
- The settings modal has one tab per plugin, and right-clicking a plugin's button opens it at that plugin's tab.
- `pnpm live` replaces `pnpm smoke` and `pnpm a11y`: the unit tests now cover all of `mod/` and the plugins on a fake
  Discord, and the live checks keep only what the running Discord decides. `pnpm check-discord` measures the contrast
  of what `mod/` colours in every Discord theme, without opening Discord.

### Fixed
- `acb watch` no longer fails inside Discord on a new-message event that carries no message.
- `acb read`, `edit`, `delete` and `send` no longer fail inside Discord before its session is up: until then no
  message counts as the user's. Autorespuesta says that the session isn't up yet instead of failing.

## [0.1.1] - 2026-11-04

### Fixed
- `acb --help` and each command's help show the usage as you type it, with a space after `acb`
  (`acb send <id> …`, not `acbsend<id> …`).

## [0.1.0] - 2026-11-04

### Added
- Corrector: fixes the spelling of the draft in the chat box and of your own sent messages, and drops any correction
  that changes words or removes parts of the message.
- Autorespuesta: drafts a reply in your tone to a message you pick, for you to review and send.
- The `acb` CLI and its Claude Code skill: drafts with a reply and attachments, the list of chats and unread
  messages, reading chats and listening for changes, and sending, editing, deleting and reacting, each only with your
  confirmation.
- A settings modal for each plugin: right-click its button in the chat box.
- `pnpm inject` and `pnpm uninject`, to patch Discord for macOS and to remove the patch.

