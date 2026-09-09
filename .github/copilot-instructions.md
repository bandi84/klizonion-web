# KLIZONION Builder Copilot Instructions

Read `context.md` before making significant changes. This repository is the separate KLIZONION Builder product, not the existing `klizonion-web` product.

Core workflow:
- ChatGPT/user designs architecture and scope.
- Copilot implements one narrowly defined milestone.
- Run relevant tests.
- Report changed files, tests, and limitations.
- STOP after the requested milestone.

Engineering rules:
- Do not rewrite unrelated working code.
- Do not create duplicate project folders or redundant files.
- Keep this repository as the single authoritative Builder codebase.
- Do not expose secrets to browser code.
- Never add unrestricted shell access.
- Preserve workspace-root boundary validation.
- Prefer complete coherent file changes over tiny line-by-line edits.
- For larger changes, keep the scope to roughly 4–5 files unless the task explicitly requires more.
- Do not introduce frameworks or dependencies without a concrete reason.
