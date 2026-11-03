# User-facing text is grouped per module
- **Practice:** user-visible strings in resource files.
- **Value not at stake:** changeability of a translation: there is one language and no plan to translate.
- **Why:** the text sits in a `TEXT` object at the top of each module that shows text, or in the definition it belongs
  to (a plugin's settings, a CLI command's entry in `COMMANDS`), whole sentences only, so a later extraction is
  mechanical.
- **Decided by:** the owner, 2026-10-30.
