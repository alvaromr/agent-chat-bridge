# Releases are single executables, signed with the project's own key only
- **Practice:** choose the distribution channel by cost and requirements, and record the decision; sign what users
  run with the platforms' own signatures (Apple's Developer ID and notarization, Microsoft's Authenticode).
- **Decision:** each `v<x.y.z>` tag's GitHub release carries one executable per system, a Node single executable
  application that holds the patch, the skill, the sources `check-discord` reads and, for Apple Silicon Macs,
  Dictation's worker and uv (README, «Install»). The release workflow builds them on CI from the tag and signs each
  with the project's ed25519 release key, whose private half is a GitHub Actions secret; the scheduled check installs
  an update only with a valid signature, on the user's yes (AGENTS.md, rule 2). Users need only Discord and Claude
  Code: no git, pnpm or Node. A clone stays the way to develop, and a clone at a release tag still updates from its
  tags. No Apple or Microsoft signature.
- **Value not at stake:** safety, for the people it is shared with. What runs is still the reviewed code of one tag,
  built by CI rather than on the user's machine; an update can't reach users without the release key, kept in GitHub,
  so trusting a release means trusting the owner's GitHub account, as trusting the clone's remote did. The first
  download is checked only by HTTPS. Without the platforms' signatures, macOS blocks and Windows warns about an
  executable downloaded with a browser, so the README downloads it with the terminal; the project is shared with
  people who trust its owner, which is what those signatures would vouch for.
- **Why:** installing from a clone asked for git, pnpm and Node, and a build, which stopped the people the owner shares
  it with; the owner wanted it installable by asking Claude, with the fewest requirements, on every system. The
  platforms' signatures cost a yearly fee for no one the project reaches.
- **Decided by:** the owner, 2026-11-19, replacing the install from a clone at a release tag (decided 2026-11-04, its
  GitHub releases 2026-11-10); the release key in GitHub, the same day.
