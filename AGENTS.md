# agent-chat-bridge

A bridge between an AI agent and the user's Discord: the official Discord app (stable channel; macOS, and Windows and
Linux experimental, `docs/decisions/windows-linux-untested.md`) with a minimal own patch (`mod/`) that loads own plugins.
Everything is managed from this repo: install, re-patch and plugins.

## Systems
What differs between macOS, Windows and Linux lives in one place per side, and everything else is shared:
- `mod/src/platform.mts`: the app's folder and the CLI's socket (a named pipe on Windows), for `mod/` and the scripts.
- `plugins/shared/run.ts` (`claudeProcess`): where `claude` is and the environment it runs with.
- `scripts/os/`: one module per system with the same exports (where Discord is, running, quit and open it, dialogs and
  notices, how pnpm and the patch run, and the scheduler of `pnpm repatch`), chosen by `scripts/os/index.mjs`;
  `posix.mjs` holds what macOS and Linux share, and `app-folders.mjs` what Windows and Linux share (Discord installs
  itself into the user's folder, one `app-<version>` per update). A new difference goes into each module, never into
  a caller.
- Dictation runs only on Apple Silicon Macs (`dictation/src/platform.ts`).

## Guiding principle
Discord handles private conversations, and the patch runs inside the app with access to the session token.
No new code reaches Discord without a review first (see «Review»). When in doubt: stop and ask.

## Structure
- `mod/`: the patch.
  - `mod/src/main.ts`: main-process loader; registers the IPC handlers and a session preload, then loads Discord.
  - `mod/src/preload.ts`: exposes `AgentChatBridgeNative` and injects the renderer into the page.
  - `mod/src/name.mts`: the project's name, the one source of its folder, IPC channels, window symbol and log prefix.
  - `mod/src/renderer/`: webpack hook, plugin registry, the CLI's request handling and the settings modal
    (README, «Use»).
  - `mod/src/plugin-api/`: what the plugins import as `@plugin-api/…`: plugin definition, settings, chat box and
    message toolbar buttons, the chat box's text (`chatInput.ts`), the wait for Discord's stores (`wait.ts`), the log
    that all of `mod/` and the plugins write through (`log.ts`, enforced by the lint), and the Discord pieces they use
    (`discord.ts`) with their types (`discordTypes.ts`). The CLI's request handling uses the same pieces; `mod/`
    imports nothing from `plugins/` but the registration, `run.ts` and `plugins/dictation/main.ts`.
  - `mod/src/electron.d.ts`: types of the Electron APIs `mod/` calls.
  - Settings: where they live and what happens to a file that can't be read are in the README («Use»). The file is
    keyed by plugin name and holds only the values that differ from the default; if an unreadable file can't be
    moved aside, saving stays blocked. There is no switch to disable a plugin: with all disabled, their buttons and
    with them the access to the modal would disappear.
- `plugins/`: own plugins, registered in `mod/src/renderer/index.ts`. They import only from `@plugin-api/` and
  `plugins/shared/`, a rule the lint enforces.
  - `plugins/shared/`: code common to the plugins; `run.ts` runs `claude -p` in the main process.
  - `plugins/corrector/`, `plugins/autorespuesta/`.
  - `plugins/dictation/`: dictation into the chat box, on `dictation/`. `main.ts` runs it in the main process; the
    rest of the plugin may also import `dictation/`'s pure modules.
- `dictation/`: the dictation engine (its README): audio in, text out phrase by phrase, with a local Whisper model run
  by a Python worker without network. Kept apart so it can leave this repo: it imports only its own files and Node's
  modules, a rule the lint enforces, and its imports carry their extensions so plain Node runs it.
- `scripts/agent-chat-bridge.mjs`: the `agent-chat-bridge` CLI, to use Discord from the terminal: leave drafts (with a
  reply and attachments), list and read chats, listen for changes (`watch`) and, with confirmation (rule 3), send,
  edit and delete own messages and react. Its documentation is its `--help`. `mod/src/compose.ts` serves it over a local
  socket. A new command goes into `COMMANDS` of `mod/src/ipc.ts`: the compiler then asks for its check in
  `mod/src/validate.ts` and its handler in `HANDLERS` of `mod/src/renderer/compose.ts`, which answers from `chats.ts`,
  `read.ts` or `write.ts` beside it, and `test/validate.test.mjs` asks for its entry in the CLI. A limit that `mod/`
  enforces and the `--help` states goes into `mod/src/limits.mts`, which the CLI loads with plain Node.
- `skills/agent-chat-bridge/`: short skill that points to the CLI's `--help` and sets the usage rules.
  `pnpm links` links the skill into `~/.claude/skills/` and the CLI into `~/.local/bin/`.
- `scripts/inject.mjs`: the patcher. Renames `app.asar` to `_app.asar` and writes a loader `app.asar`, built by
  `scripts/asar.mjs`. `scripts/discord-app.mjs` holds the patch's paths and Discord's version (its
  `build_info.json`), on every system, which it shares with `scripts/repatch.mjs`, the offer to re-patch after an
  update («When Discord updates»), and `pnpm check-discord`.
- `scripts/bundle.mjs`: whether this runs from a clone or as the release's single executable (a Node single
  executable application), and where the files are: the clone's, or the ones the executable carries, unpacked into
  the app's folder as laid out in the repo. `scripts/install.mjs` holds the CLI's own commands: `install` and
  `uninstall` in the executable, and `inject`, `uninject`, `check-discord` and `repatch`, the pnpm scripts' steps,
  which the scheduled re-patch calls the executable for. The executable updates from GitHub's releases
  (`scripts/release-feed.mjs`), checking each new executable's ed25519 signature against `scripts/release-key.mjs`
  (rule 2). `scripts/build-executable.mjs` builds the executables
  (`pnpm build-executable`) from `scripts/executable.mjs`, on Node's official binaries, pinned by their SHA-256.
- `test/` and `dictation/test/`: the `*.test.mjs` files (Vitest, `vitest.config.mjs`) test all of `mod/`, `plugins/`
  and `dictation/src/`, and the CLI, without Discord and without network (`test/setup.mjs` refuses every
  connection). What touches Discord runs on a fake one: `test/fake-discord.mjs` for `mod/src/plugin-api/discord.ts`,
  with the React Discord ships, `test/fake-native.mjs` for what the preload exposes, `test/fake-webpack.mjs` for
  Discord's webpack runtime, and happy-dom for the page (`@vitest-environment happy-dom`, `test/dom.mjs`); Electron,
  the system and the worker's process on `vi.mock`s. New code gets its test in the same change; the coverage counts
  the `mutate` list of `stryker.config.mjs`, and what stays out is in `docs/decisions/coverage-io-scripts-and-worker.md`. A fix
  gets a regression test that fails without it. The suite passes on macOS, Windows and Linux: a test that fakes a Mac
  or a Linux fakes `process.platform` and, where its code splits no real path, Node's path module
  (`dictation/test/posix-path.mjs`). `test/live/`, `test/smoke-os.mjs` and `dictation/test/worker.mjs` run on
  `node --test` instead, so neither Vitest nor Stryker runs them: `test/live/` checks in the running Discord that its
  real stores answer the CLI in the shape faked (`pnpm live`), publishing nothing, asking nothing of the API and
  showing no content; `smoke-os.mjs` runs the system's side for real (`pnpm smoke-os`); the last runs the real
  dictation worker.
- `scripts/check-discord/`: `pnpm check-discord`, on `node --test` too, which the scheduled re-patch runs before it
  asks. `code.mjs` finds the patches and the pieces of `mod/` in the Discord code of its HTTP cache (`cache.mjs`),
  without running it or reading the API responses the cache also holds, and `css.mjs` measures there the contrast of
  what `mod/` colours in every Discord theme. They read `mod/`'s and the plugins' sources where `scripts/bundle.mjs`
  says the files are.
- `.github/workflows/ci.yml`: on every push and pull request, the unit tests and `pnpm smoke-os` on Windows and Linux
  (GitHub's `windows-latest` and `ubuntu-latest`), the systems no one runs them on by hand. The gate stays the
  pre-commit hook, on macOS. `.github/workflows/release.yml`: on the push of a release tag, the executables built on a
  Mac, signed with the release key (`scripts/sign-release.mjs`, the secret `RELEASE_SIGNING_KEY`), each started on its
  system, and the GitHub release with the tag's notes, the executables, their signatures and the licence.
- `docs/debugging.md`: how to verify a failure in the running Discord. Read it before diagnosing any failure of
  `mod/` or the plugins. `scripts/cdp.mjs` is its tool.

## Commands
Defined in `package.json`.
- `pnpm bootstrap`: hooks path, dependencies and build; the dictation worker's packages, with `uv`, only where they can
  run (`scripts/setup-dictation.mjs`). Not named `setup`, which is pnpm's own command. Before it, a clone whose
  dependencies differ from the lockfile, a fresh one included, needs `pnpm install --frozen-lockfile`: pnpm checks
  them before every script (`verifyDepsBeforeRun`).
- `pnpm check`: the gate before each commit, run by the `.githooks/` pre-commit hook on the staged files: `pnpm lint`
  (`eslint.config.mjs`, formatting included, and Ruff on the dictation worker, `dictation/worker/pyproject.toml`),
  `pnpm typecheck`, `pnpm knip` (unused files, exports and dependencies, `knip.json`), `pnpm secrets` (gitleaks on the
  history and the tree) and `pnpm test`. `pnpm fix` applies the automatic fixes and runs the gate.
- `pnpm build`: builds `mod/dist/` (`mod/tsconfig.json`). `pnpm typecheck`: types of the whole repo, the plain JS
  files through JSDoc (`tsconfig.json`), and the worker's with ty.
- `pnpm build-executable [<target>...]`: `pnpm build`, then the release's executable for each system, or the ones
  named (`darwin-arm64`, `darwin-x64`, `linux-x64`, `win-x64`), into `dist/`. Node's archives are downloaded once into
  `node_modules/.cache/`. A local build keeps this machine's paths in its stack traces, so it is never published.
  Try one in a throwaway HOME or container, never with `install`, which patches the Discord installed on the machine.
- `pnpm test`: tests without Discord, with 100 % line, branch, function and statement coverage.
- `pnpm mutation`: Stryker on the code the coverage counts, with a 100 % score, run by the `.githooks/` pre-push hook instead of
  the pre-commit one, and by `pnpm release`. Run it after changing one of them or their tests. `scripts/mutation.mjs`
  runs it below normal priority and incremental: it re-tests only the mutants whose code or covering tests changed.
  That run sees no change in the shared test helpers, the dependencies or the test and mutation configs (`UNSEEN`
  there), so when one of them is newer than the last result, or there is no result, it runs the full set and prints
  why. A full run takes about 20 minutes, so it runs only then, or when asked with `pnpm mutation --full`. Every
  surviving mutant gets a test, or an inline `// Stryker disable next-line <mutator>: <reason>` when it is equivalent.
- `pnpm run audit`: known advisories in the dependencies, the worker's Python packages included (`uv audit`); part of
  the review of any dependency change, and run by the pre-push hook and `pnpm release`. Plain `pnpm audit` is pnpm's
  own command, which checks only the Node packages.
- `pnpm live`: the live checks (`test/live/`), in the running, patched Discord, read-only through the CLI's socket
  (`docs/debugging.md`, method 4): that its real stores answer the CLI in the shape the unit tests fake. Outside the
  gate, in the user's own Discord (`docs/decisions/live-checks-in-users-discord.md`). Run it only after a Discord
  update, or after a change to how `mod/` reads Discord. Keyboard and focus aren't checked live
  (`docs/decisions/accessibility-outside-gate.md`).
- `pnpm smoke-dictation`: the real dictation worker on a phrase that `say` speaks; Discord need not be open. Run it
  after a change to `dictation/src/worker.ts`, `dictation/worker/` or its packages.
- `pnpm smoke-os`: the system's side for real, without Discord: the CLI against a socket of its own (a named pipe on
  Windows), the check of a running Discord and, on CI's Windows machine only, the scheduled task and its PowerShell
  script. CI runs it on Windows and Linux; run it after a change to `scripts/os/` or `mod/src/platform.mts`.
- `pnpm check-discord`: patches, pieces and the contrast of what `mod/` colours, in every theme, against the last
  Discord version the app loaded; Discord need not be open. Run it after a change to `mod/`'s or the plugins' colours.
- `pnpm inject` / `pnpm uninject`: patch (or re-patch) Discord with `mod/`, or remove the patch. Discord closed.
  After `pnpm build`, restarting Discord is enough: the loader reads `mod/dist/` on every start.
- `pnpm repatch install` / `pnpm repatch uninstall`: add or remove the scheduled check that offers to re-patch Discord
  after an update («When Discord updates») and each new release (README, «Update»): to the executable, its signed
  executable; to a clean clone at a release tag, the tag. A development clone, off a release tag, is never updated.
- `pnpm release <x.y.z>`: the release from main (`scripts/release.mjs`): the gate, the audit, `pnpm mutation`,
  `pnpm check-discord` and a fresh clone installed and tested, the worker, `pnpm smoke-dictation` and this system's
  executable included, then the version in `package.json`, the dated `CHANGELOG.md` section opened by the Discord it
  was tested with (the app's version and its web client's build), the commit and the `v<x.y.z>` tag, whose message is
  that section. Then push with `git push --follow-tags`: the tag starts `.github/workflows/release.yml`. A user-visible
  change adds its entry under `[Unreleased]` in the same commit. Tags are never moved or deleted: the `.githooks/`
  reference-transaction hook refuses it here, and the pre-push hook on the remote.

## Rules
1. **As close to Discord as possible**: `mod/` contains only what the own plugins use: no themes, custom CSS or
   features of its own.
2. **No updaters but this repo's releases**: `mod/` changes only through this repo. In a clone, by its commits; in
   the release's executable, by a release whose executable for that system the release key signed
   (`scripts/release-key.mjs`), which the scheduled check installs only on the user's yes (`scripts/repatch.mjs`).
   `scripts/release-feed.mjs` is its only request, to GitHub's releases.
3. **Discord's terms**: modifying the client breaks them; the risk stays low by avoiding automation.
   - Every send or edit is triggered by an explicit user action, never automatically. The Corrector edits without a
     dialog on Enter in an empty box and with its button on an own message: the key or the click is the confirmation.
     A correction that changes words or removes parts of the message is never sent or saved that way: it stays in the
     chat box unsent, or opens in the message's edit box unsaved, for the user to review.
   - Claude may publish with the CLI (`send`, `edit`, `delete` and `react`) only with the user's explicit
     confirmation, after showing what rule 1 of `skills/agent-chat-bridge/SKILL.md` sets for each command. `send`
     requires the confirmed text and sends by pressing Enter in the box, Discord's normal path; with `--direct`, with
     the send action that box uses, without opening the chat. `edit` and `delete` act on own messages only, always with
     confirmation, in the auto-reply too.
   - Auto-reply experiment: see «Auto-reply» in `skills/agent-chat-bridge/SKILL.md`. Only in chats the user enables for
     one session, with the messages marked as Claude's and the rate limit that `send` enforces.
   - Read only messages the app already has loaded; never download histories through the API or make requests in a
     loop. Exceptions, always on an explicit request:
     - `agent-chat-bridge read --fetch`: 1 request, the one Discord makes when opening a chat (`fetchMessages` of its
       message manager).
     - `agent-chat-bridge read --more`: older pages, as scrolling up does, up to `MAX_EXTRA_PAGES`
       (`mod/src/limits.mts`) and only back to the first unread message.
     - `agent-chat-bridge read --older <n>`: for the context of a message the user asks to write, n older pages up to
       the same limit, read or not, the same request as `--more`.
     - Between pages, `mod/` waits like someone scrolling up (`PAGE_PAUSE_MS` in `mod/src/renderer/read.ts`).
4. **Models**: the plugins only use the local `claude -p` (the user's subscription) and, for dictation, a Whisper model
   on disk, run by `dictation/`'s worker under a macOS sandbox profile that denies it the network and every write
   outside the user's temporary folder (`dictation/src/worker.ts`). The `agent-chat-bridge` CLI
   hands chat content to the Claude Code session that runs it, at the user's request. No other network destination for
   chat content or the user's voice. `mod/` makes no network requests of its own, except the Discord API calls rule 3
   allows.
5. **Privacy in own plugins**: never record message content, the token or the dictation's audio or text in logs or
   persistent files; the audio stays in memory. If a plugin needs to dump a chat (Claude session), only the minimum,
   outside the repo, deleted at the end.
6. **Dependencies**: development tools only; nothing from `node_modules` reaches Discord except what esbuild bundles
   from this repo. The one exception, outside Discord: the release's executable bundles `typescript`, which
   `check-discord` parses Discord's cached code with, without running it. Exact versions, no install scripts (`allowBuilds` in `pnpm-workspace.yaml`), and a `trustPolicy`
   exception only for an exact, reviewed version, with its reason next to it. The dictation worker's Python packages
   (`dictation/worker/uv.lock`) run on this machine, outside Discord, the worker's without network and its `dev`
   group's (Ruff and ty, the gate's) as development tools: exact versions with their hashes, wheels only (no build
   code runs on install), and at least 7 days old when locked (`exclude-newer`). uv and Python are pinned as well
   (`required-version` and `dictation/worker/.python-version`).

## Review
Mandatory before each `pnpm inject`, and before committing any change in `plugins/`, `mod/`, `dictation/`, `scripts/`,
`skills/` or the dependencies. The commit message states what was reviewed and the result. If something fails the
review: do not patch, and ask the user.

**What gets reviewed**, by change:
- **Own code** (`mod/`, `plugins/`, `dictation/`, `scripts/`, `skills/`): the whole diff, against rules 3, 4 and 5.
- **Dependencies**: each new or updated package in `pnpm-lock.yaml` or `dictation/worker/uv.lock`: publisher,
  provenance, install scripts and the changelog since the previous version. They run on this machine.
- **Re-patch without changes**: that `mod/dist/` is rebuilt from the reviewed commit, with a clean tree; in the
  executable, that its files are the ones of the release it installed with a valid signature.

**What to look for**:
- Network exits: `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `<img>`/`<iframe>`/CSS to external hosts, CSP
  changes, IPC handlers in `mod/src/main.ts` that do network or start processes, and a dictation worker started
  without its sandbox profile.
- Access to the token, to `MessageStore`/`ChannelStore` or to message content outside its declared purpose.
- `eval`, `new Function`, obfuscated, minified or base64-encoded code.

## When Discord updates
The update replaces Discord's app (on Windows, a new `app-<version>` folder) and the patch disappears; `pnpm inject`
restores it. Then run `pnpm check-discord` and `pnpm live`.
With `pnpm repatch install`, or the executable's `install`, a scheduled check does the first part once per Discord
version that lost the patch (`scripts/repatch.mjs`; when it runs on each system, README «Install»). It holds to the
review of a re-patch without changes: with a clean tree (in the executable, the signed release's files) and
`check-discord` passing, it asks in a dialog, and only on a yes it quits Discord, rebuilds `mod/dist/` (in the
executable, unpacks it), patches and reopens it. On macOS a helper app, «Reparchear Discord (agent-chat-bridge)», does
the patching: macOS lets only an app with its App Management permission change another app, and the user grants it
to the helper once; a new build of the helper loses it, so an install keeps the one there while its AppleScript is the
same. Otherwise a notification says what failed, and the log's path is in it.
`pnpm live` stays manual.
If a patch or piece is no longer found (`pnpm check-discord`, or the settings modal with Discord open), find what
changed in Discord's code (`docs/debugging.md`, method 3) and adapt `mod/`. `mod/` was first derived from Vencord
(<https://github.com/Vendicated/Vencord>): when the cause is unclear, see how its repo solved the same change, and
review what you take from it like own code. A file that takes code from it says so at its top (README, «License»).
The loader depends on Discord not enabling the Electron fuse `EnableEmbeddedAsarIntegrityValidation` (disabled on
2026-10-28, Electron 42). If it enables it, no loader in `app.asar` starts.

## Conventions
- **User-facing text is in Spanish:** CLI help and errors, toasts, the settings modal, prompts and the skill's
  replies, because the user reads them in Spanish. Logs, internal errors and test names are in English.
- **User-facing text is grouped per module:** in a `TEXT` object at the top of each module that shows text, or in the
  definition it belongs to (a plugin's settings, a CLI command's entry in `COMMANDS`), in whole sentences. No resource
  files while there is one language and no plan to translate.

## Decisions and deviations
Deviations from the engineering baseline live in `docs/decisions/`, one file each, with the value that is not at
stake, why, and who decided. Read them before changing a practice; a new deviation gets its own file there.
