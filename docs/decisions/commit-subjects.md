# Commit subjects without a Conventional Commits prefix
- **Practice:** Conventional Commits for new repositories.
- **Value not at stake:** changeability through a generated changelog: there is none (`no-version-changelog-tags.md`).
- **Why:** the repo's convention is a plain imperative subject. The `.githooks/commit-msg` hook checks what a machine
  can: length, initial capital, no final period, no WIP.
- **Decided by:** the owner, 2026-11-03.
