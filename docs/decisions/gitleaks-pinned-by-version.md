# gitleaks is pinned by version, not by a checksum in the repo
- **Practice:** pin installers and binaries by version and checksum.
- **Value not at stake:** safety of the binary's integrity: Homebrew checks each download against the checksum in its
  formula, as for any tool it installs.
- **Why:** `scripts/secrets.mjs` runs only that version's binary, by its path, so an upgrade never runs before its
  changelog is read and the version bumped there.
- **Decided by:** the owner, 2026-10-30.
