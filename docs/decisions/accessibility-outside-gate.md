# Accessibility is checked without the running Discord
- **Practice:** verify UI with real assistive technology and automated checks, and gate UI commits on them where
  tooling allows.
- **Value not at stake:** correctness for keyboard and screen-reader users, as far as `mod/` decides it. What `mod/`
  renders (roles, names, labels, the tabs' keys) is checked by the gate, in the unit tests on a fake Discord, and the
  contrast of what it colours, in every Discord theme, by `pnpm check-discord` on the stylesheets of Discord's cache.
  The keyboard paths, focus rings and modal focus come from Discord's own components (`ChatBarButton`, `Modal`,
  `TextArea`), which Discord keeps working for its own users; nothing checks them in the running Discord any more, nor
  that the backgrounds `test/discord-css.mjs` measures against are the ones Discord paints.
- **Why:** those checks needed the user's own Discord with the debugging port open, and the user left alone while
  they pressed keys in it: they interrupted the user's work, and a use of Discord meanwhile made them fail. The owner
  judged them not vital. `pnpm check-discord` stays outside the gate because it needs the Discord version the app
  last loaded in its cache, which the gate's clean checkout doesn't have.
- **Decided by:** the owner, 2026-10-30; the split, 2026-11-05; the contrast to `pnpm check-discord` and the live
  checks of the running Discord dropped, 2026-11-06.
