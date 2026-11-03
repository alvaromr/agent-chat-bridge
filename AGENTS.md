# discord-mod

The official Discord app (macOS, stable channel) with a minimal own patch (`mod/`) that loads own plugins.
Everything is managed from this repo: install, re-patch and plugins.

## Guiding principle
Discord handles private conversations, and the patch runs inside the app with access to the session token.
No new code reaches Discord without a review first (see «Review»). When in doubt: stop and ask.

## Structure
- `mod/`: the patch.
  - `mod/src/main.ts`: main-process loader; registers the IPC handlers and a session preload, then loads Discord.
  - `mod/src/preload.ts`: exposes `DiscordModNative` and injects the renderer into the page.
  - `mod/src/renderer/`: webpack hook, plugin registry, the CLI's request handling and the settings modal
    (right-click a plugin button of the chat box).
  - `mod/src/plugin-api/`: what the plugins import as `@plugin-api/…`: plugin definition, settings, chat box and
    message toolbar buttons, the chat box's text (`chatInput.ts`), the wait for Discord's stores (`wait.ts`), and the
    Discord pieces they use (`discord.ts`) with their types (`discordTypes.ts`). The CLI's request handling uses the
    same pieces; `mod/` imports nothing from `plugins/` but the registration and `run.ts`.
  - `mod/src/electron.d.ts`: types of the Electron APIs `mod/` calls.
  - Settings live in `~/Library/Application Support/discord-mod/settings.json`, keyed by plugin name, only the
    values that differ from the default. A file that can't be read is moved aside (`settings.json.unreadable-<ms>`)
    and a dialog says so; if it can't be moved, saving stays blocked. There is no switch to disable a plugin: with
    both disabled, their buttons and with them the access to the modal would disappear. Each feature has its own
    setting to turn it off.
- `plugins/`: own plugins, registered in `mod/src/renderer/index.ts`. They import only from `@plugin-api/` and
  `plugins/shared/`, a rule the lint enforces.
  - `plugins/shared/`: code common to the plugins; `run.ts` runs `claude -p` in the main process.
  - `plugins/corrector/`, `plugins/autorespuesta/`.
- `scripts/discord-mod.mjs`: the `discord-mod` CLI, to use Discord from the terminal: leave drafts (with a reply and
  attachments), list and read chats, listen for changes (`watch`) and, with confirmation (rule 3), send, edit and
  delete own messages and react. Its documentation is its `--help`. `mod/src/compose.ts` serves it over a local
  socket. A new command goes into `COMMANDS` of `mod/src/ipc.ts`: the compiler then asks for its check in
  `mod/src/validate.ts` and its handler in `mod/src/renderer/compose.ts`, and `test/validate.test.mjs` asks for its
  entry in the CLI. A limit that `mod/` enforces and the `--help` states goes into `mod/src/limits.mts`, which the CLI
  loads with plain Node.
- `skills/discord-mod/`: short skill that points to the CLI's `--help` and sets the usage rules.
  `pnpm links` links the skill into `~/.claude/skills/` and the CLI into `~/.local/bin/`.
- `scripts/inject.mjs`: the patcher. Renames `app.asar` to `_app.asar` and writes a loader `app.asar`, built by
  `scripts/asar.mjs`.
- `test/`: the `*.test.mjs` files (Vitest, `vitest.config.mjs`) test the pure logic without Discord, and without
  network (`test/setup.mjs` refuses every connection): logic exported by the CLI or `scripts/asar.mjs`, or in `mod/`
  and `plugins/` modules with no Discord or Electron imports except types (`import type`). New pure logic goes into
  one of those modules, with its test, and into the `mutate` list of `stryker.config.mjs`.
  `smoke.mjs` and `discord-code.mjs` run on `node --test` instead, so neither Vitest nor Stryker runs them.
  `smoke.mjs` tests in the running Discord only what publishes nothing and asks nothing of the API, and shows no
  content. `discord-code.mjs` finds the patches and the pieces of `mod/` in the Discord code of its HTTP cache, without
  running it or reading the API responses the cache also holds.
- `docs/debugging.md`: how to verify a failure in the running Discord. Read it before diagnosing any failure of
  `mod/` or the plugins. `scripts/cdp.mjs` and `scripts/a11y.mjs` are its tools, over `scripts/devtools.mjs`.

## Commands
Defined in `package.json`.
- `pnpm setup`: hooks path, dependencies and build.
- `pnpm check`: the gate before each commit, run by the `.githooks/` pre-commit hook on the staged files: `pnpm lint`
  (`eslint.config.mjs`, formatting included), `pnpm typecheck`, `pnpm knip` (unused files, exports and dependencies,
  `knip.json`), `pnpm secrets` (gitleaks on the history and the tree) and `pnpm test`. `pnpm fix` applies the
  automatic fixes and runs the gate.
- `pnpm build`: builds `mod/dist/` (`mod/tsconfig.json`). `pnpm typecheck`: types of the whole repo, the plain JS
  files through JSDoc (`tsconfig.json`).
- `pnpm test`: tests without Discord, with 100 % line, branch, function and statement coverage.
- `pnpm mutation`: Stryker on the pure modules, outside the hook, with a 100 % score. Run it after changing one of
  them or their tests. It is incremental and re-tests only what changed, but it can keep a stale survivor after a
  test change: before committing, confirm with `pnpm mutation --force` (about 2 min). Every surviving mutant gets a
  test, or an inline `// Stryker disable next-line <mutator>: <reason>` when it is equivalent.
- `pnpm audit`: known advisories in the dependencies; part of the review of any dependency change.
- `pnpm smoke`: read-only checks with Discord open and patched.
- `pnpm check-discord`: patches and pieces against the last Discord version the app loaded; Discord need not be open.
- `pnpm a11y`: names, keyboard paths and contrast of what `mod/` adds, in both themes, through the debugging port
  (`docs/debugging.md`, method 4). Run it after a change to what `mod/` or the plugins show.
- `pnpm inject` / `pnpm uninject`: patch (or re-patch) Discord with `mod/`, or remove the patch. Discord closed.
  After `pnpm build`, restarting Discord is enough: the loader reads `mod/dist/` on every start.

## Rules
1. **As close to Discord as possible**: `mod/` contains only what the own plugins use: no themes, custom CSS or
   features of its own.
2. **No updaters**: `mod/` changes only through this repo.
3. **Discord's terms**: modifying the client breaks them; the risk stays low by avoiding automation.
   - Every send or edit is triggered by an explicit user action, never automatically. The Corrector edits without a
     dialog on Enter in an empty box and with its button on an own message: the key or the click is the confirmation.
     It discards the correction if it changes words or removes parts of the message.
   - Claude may publish with the CLI only with the user's explicit confirmation:
     - **`discord-mod send`:** after showing the draft (chat, text, reply and attachments). It requires the confirmed
       text and sends by pressing Enter in the box, Discord's normal path; with `--direct`, with the send action that
       box uses, without opening the chat.
     - **`discord-mod edit` and `delete`:** own messages only, after quoting the message and, when editing, the new
       text. Always with confirmation, in the auto-reply too.
     - **`discord-mod react`:** after saying which message and which emoji, also to remove the reaction.
   - Auto-reply experiment: see «Auto-reply» in `skills/discord-mod/SKILL.md`. Only in chats the user enables for one
     session, with the messages marked as Claude's and the rate limit that `send` enforces.
   - Read only messages the app already has loaded; never download histories through the API or make requests in a
     loop. Exceptions, always on an explicit request:
     - `discord-mod read --fetch`: 1 request, the one Discord makes when opening a chat (`fetchMessages` of its
       message manager).
     - `discord-mod read --more`: up to 3 older pages of 50 messages, as scrolling up does, and only back to the
       first unread message.
     - `discord-mod read --older <n>`: for the context of a message the user asks to write, n older pages (1 to 3),
       read or not, the same request as `--more`. The skill sets one page at a time and 3 per message.
     - Between pages, `mod/` waits 1.5 s, like someone scrolling up.
4. **LLM**: the plugins only use the local `claude -p` (the user's subscription). The `discord-mod` CLI hands chat
   content to the Claude Code session that runs it, at the user's request. No other network destination for chat
   content. `mod/` makes no network requests of its own, except the Discord API calls rule 3 allows.
5. **Privacy in own plugins**: never record message content or the token in logs or persistent files. If a plugin
   needs to dump a chat (Claude session), only the minimum, outside the repo, deleted at the end.
6. **Dependencies**: development tools only; nothing from `node_modules` reaches Discord except what esbuild bundles
   from this repo. Exact versions, no install scripts (`allowBuilds` in `pnpm-workspace.yaml`), and a `trustPolicy`
   exception only for an exact, reviewed version, with its reason next to it.

## Review
Mandatory before each `pnpm inject`, and before committing any change in `plugins/`, `mod/`, `scripts/`, `skills/` or
the dependencies. The commit message states what was reviewed and the result. If something fails the review: do not
patch, and ask the user.

**What gets reviewed**, by change:
- **Own code** (`mod/`, `plugins/`, `scripts/`, `skills/`): the whole diff, against rules 3, 4 and 5.
- **Dependencies**: each new or updated package in `pnpm-lock.yaml`: publisher, provenance, install scripts and the
  changelog since the previous version. They run on this machine.
- **Re-patch without changes**: that `mod/dist/` is rebuilt from the reviewed commit, with a clean tree.

**What to look for**:
- Network exits: `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `<img>`/`<iframe>`/CSS to external hosts, CSP
  changes, IPC handlers in `mod/src/main.ts` that do network or start processes.
- Access to the token, to `MessageStore`/`ChannelStore` or to message content outside its declared purpose.
- `eval`, `new Function`, obfuscated, minified or base64-encoded code.

## When Discord updates
macOS replaces the whole app and the patch disappears; `pnpm inject` restores it.
If a patch or piece is no longer found (`pnpm check-discord`, or the settings modal with Discord open), find what
changed in Discord's code (`docs/debugging.md`, method 3) and adapt `mod/`. `mod/` was first derived from Vencord
(<https://github.com/Vendicated/Vencord>): when the cause is unclear, see how its repo solved the same change, and
review what you take from it like own code.
The loader depends on Discord not enabling the Electron fuse `EnableEmbeddedAsarIntegrityValidation` (disabled on
2026-10-28, Electron 42). If it enables it, no loader in `app.asar` starts.

## Decisions and deviations
Deviations from the engineering baseline, with the value that is not at stake and why.
- **Coverage covers the pure modules only.** The rest of `mod/` and `plugins/` runs only inside Discord, so its
  checks are `pnpm smoke`, `pnpm check-discord` and the methods of `docs/debugging.md`. The CLI's socket side is
  excluded in place, with that reason. The coverage counts only the files the tests load, so the scripts that are only
  I/O stay out of it and are checked by running them: `scripts/inject.mjs` (`pnpm inject`), `scripts/secrets.mjs`
  (`pnpm check`), `scripts/cdp.mjs`, `scripts/a11y.mjs` and `scripts/devtools.mjs` (`docs/debugging.md`) and
  `mod/build.mjs` (`pnpm build`).
- **gitleaks is pinned by version, not by a checksum in the repo:** it comes from Homebrew, which checks each download
  against the checksum in its formula, so integrity rests on Homebrew as for any tool it installs.
  `scripts/secrets.mjs` runs only that version's binary, by its path, so an upgrade never runs before its changelog
  is read and the version bumped there.
- **The accessibility checks run outside the gate,** with `pnpm a11y`: they need the running Discord with the
  debugging port, which needs the user's permission each time, since any program on the machine can read Discord
  while it is open.
- **Lint and types allow `any`** (`no-explicit-any` off, `noImplicitAny: false`), and the lint is not type-aware:
  Discord's internals are untyped, and `discordTypes.ts` types only the members the code uses.
- **No separate formatter:** the lint's stylistic rules format the code.
- **TypeScript stays on 6.0:** TypeScript 7 ships no JavaScript API, which typescript-eslint (`typescript <6.1.0`),
  Stryker's TypeScript checker and `test/discord-code.mjs` load. Move when they support it.
- **No version, changelog or tags:** nothing is released or distributed; the reviewed commit is the version.
- **User-facing text is in Spanish:** CLI help and errors, toasts, the settings modal, prompts and the skill's
  replies, because the user reads them in Spanish. Logs, internal errors and test names are in English.
- **User-facing text is grouped per module:** in a `TEXT` object at the top of each module that shows text, or in the
  definition it belongs to (a plugin's settings, a CLI command's entry in `COMMANDS`). No resource files while there
  is one language and no plan to translate.
- **Commit subjects** follow the repo's convention: plain imperative, no Conventional Commits prefix. The
  `.githooks/commit-msg` hook checks what a machine can: length, initial capital, no final period, no WIP.
