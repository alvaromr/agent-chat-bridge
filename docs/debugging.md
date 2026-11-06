# Debugging the patch in Discord

Failures of `mod/` and of the plugins that depend on Discord only show in the running Discord. `pnpm test` runs all
their code on a fake Discord, `pnpm check-discord` checks what Discord's cached code and styles show without running
them (method 3), and `pnpm live` what only the running one decides (method 4).

## Rule
Before stating a cause or accepting a fix, verify it in the real Discord with one of the methods below.
An unverified hypothesis is presented as a hypothesis, and the first step is to set up the way to check it.

## Privacy
- Never read or log message content or drafts: compare them with a test text, or measure their length.
- If the open chat's draft is not empty, stop and ask the user for a chat with an empty box.
- Never send or edit messages during a test without the user's explicit confirmation of chat and text. Leave the box
  as it was.

## 1. Console log
Shows whether something runs, and in which order. The user has to reproduce the failure.
1. Quit Discord: `osascript -e 'quit app "Discord"'`.
2. Start it in the background with the filtered log (errors also come out as `CONSOLE` lines), writing to a
   temporary file outside the repo:
   ```sh
   /Applications/Discord.app/Contents/MacOS/Discord --enable-logging=stderr 2>&1 \
     | grep --line-buffered CONSOLE | grep --line-buffered -E "agent-chat-bridge|AgentChatBridge|Uncaught" > "$TMPDIR/discord.log"
   ```
3. If temporary marks are needed, they log only lengths or states, with the `[agent-chat-bridge] DEBUG` prefix.
4. When done: remove the marks, delete the log and restart Discord with `open -a Discord`.

## 2. Debugging port
Runs code in the page and checks the result without depending on the user.
Ask for permission first: while the port is open, any program on the machine can read all of Discord.
1. Quit Discord and start it in the background with
   `/Applications/Discord.app/Contents/MacOS/Discord --remote-debugging-port=9229 --remote-debugging-address=127.0.0.1`.
2. To reach the patch's functions, expose them temporarily in `mod/src/renderer/index.ts`, inside the
   `window[Symbol.for("agent-chat-bridge")]` object. Discord's main webpack is not reachable from outside.
3. Write the test script in a temporary folder outside the repo. Run it with `node scripts/cdp.mjs <script.js>`.
4. After `pnpm build`, reload with `node scripts/cdp.mjs --reload`, without restarting Discord.
5. When done: remove the temporary exposure, rebuild, restart Discord with `open -a Discord` and check that the port
   is closed (`curl -s -m 2 http://127.0.0.1:9229/json` must fail).

## 3. Discord's code
`pnpm check-discord` checks the patches and pieces of `mod/` against it, and the contrast of what `mod/` colours in
each of its themes against its stylesheets. To see how a piece of Discord works, search
the JS files its HTTP cache already holds: `~/Library/Application Support/discord/Cache/Cache_Data/`. Use
`grep -l -a "<text>"`, then extract the context with `python3 -I`; `grep -o` with a long context fails on these
files. The cache also holds API responses with private messages: read only the script and style files.

## 4. Live checks
`pnpm live` (`test/live/`) checks what neither the fake Discord of the unit tests nor `pnpm check-discord` can: that
the real stores answer the CLI in the shape faked (`cli.mjs`), through the CLI's socket of the Discord already open.
It needs no debugging port and presses no keys; it prints only check names, and exits with 1 if one fails.

Keyboard paths, focus and the backgrounds behind what `mod/` colours were checked live until 2026-11-06, with the
debugging port and key presses in the user's Discord; they interrupted the user, and a use of Discord meanwhile made
them fail (`docs/decisions/accessibility-outside-gate.md`). To look at one of them again, use method 2.

A second Discord in the same macOS account doesn't keep the live checks apart from the user's: one started with `--multi-instance`
and its own `DISCORD_USER_DATA_DIR` opened signed in to the user's account (tried on 2026-11-06), so its session
doesn't live in that folder.
