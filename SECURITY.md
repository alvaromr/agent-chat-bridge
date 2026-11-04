# Security policy

## Reporting a vulnerability
Report it privately with GitHub's private vulnerability reporting: the repository's **Security** tab, then **Report a
vulnerability**. Please don't open a public issue for it.

## What counts
agent-chat-bridge runs inside Discord, next to the session token and the chats. Anything that lets a web page, another app
or a chat message do one of these is in scope:
- Read the token, or chats beyond what the user asked for.
- Run code or start a process.
- Send, edit, delete or react without the user's confirmation.
- Send chat content to any destination other than the user's local Claude Code (`AGENTS.md`, rule 4).

## Supported versions
Only the latest release gets fixes.
