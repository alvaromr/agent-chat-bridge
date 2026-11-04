# Changelog
What changes for whoever installs agent-chat-bridge, per version. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [SemVer](https://semver.org/):
`pnpm release` moves the entries under `[Unreleased]` to the new version.

## [Unreleased]

### Added
- Corrector: fixes the spelling of the draft in the chat box and of your own sent messages, and drops any correction
  that changes words or removes parts of the message.
- Autorespuesta: drafts a reply in your tone to a message you pick, for you to review and send.
- The `discord-mod` CLI and its Claude Code skill: drafts with a reply and attachments, the list of chats and unread
  messages, reading chats and listening for changes, and sending, editing, deleting and reacting, each only with your
  confirmation.
- A settings modal for each plugin: right-click its button in the chat box.
- `pnpm inject` and `pnpm uninject`, to patch Discord for macOS and to remove the patch.
