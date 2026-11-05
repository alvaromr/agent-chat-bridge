# Debugging the patch in Discord

Failures of `mod/` and of the plugins that depend on Discord only show in the running Discord. `pnpm test` runs all
their code on a fake Discord, and `pnpm live` checks what only the real one decides (method 4).

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
`pnpm check-discord` checks the patches and pieces of `mod/` against it. To see how a piece of Discord works, search
the JS files its HTTP cache already holds: `~/Library/Application Support/discord/Cache/Cache_Data/`. Use
`grep -l -a "<text>"`, then extract the context with `python3 -I`; `grep -o` with a long context fails on these
files. The cache also holds API responses with private messages: read only the script files.

## 4. Live checks
`pnpm live` (`test/live/`) checks what the fake Discord of the unit tests can't: that the real stores answer the CLI
in the shape faked (`cli.mjs`), and, in both themes, that Discord's own components and colours give what `mod/` adds
its roles and names, keyboard paths and focus rings, modal focus and contrast (`a11y.mjs`).
1. Open the debugging port as method 2 says, with its permission.
2. Open a chat whose box is empty, and leave Discord alone while the checks run: they press keys in Discord.
3. Run `pnpm live`. It prints only check names and measures, and exits with 1 if one fails.
4. When done, close the port as method 2 says.
