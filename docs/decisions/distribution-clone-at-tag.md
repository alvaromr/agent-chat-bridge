# Releases are installed from a clone at a release tag
- **Practice:** choose the distribution channel by cost and requirements, and record the decision.
- **Decision:** the repo is public on GitHub, and a release is its `v<x.y.z>` tag: users clone it at the latest tag and
  install it from source (README, «Install»). No package, installer or prebuilt bundle.
- **Why:** `mod/` runs inside the user's Discord, next to the token and the chats, and changes only through this repo
  (rule 2). From a clone, what runs is the reviewed code of one commit, built on the user's machine. A package or a
  prebuilt bundle would be a second artifact to build, review and keep in step with the repo.
- **Decided by:** the owner, 2026-11-04, when choosing to publish the repo on GitHub.
