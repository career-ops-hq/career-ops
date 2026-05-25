# Career-Ops for Codex

Read `CLAUDE.md` for all project instructions, routing, and behavioral rules. They apply equally to Codex.

Key points:
- Reuse the existing modes, scripts, templates, and tracker flow — do not create parallel logic.
- Store user-specific customization in `config/profile.yml`, `modes/_profile.md`, or `article-digest.md` — never in `modes/_shared.md`.
- Never submit an application on the user's behalf.

**Skill file requirement:** The career-ops skill needs `modes/_shared.md` and mode files (e.g., `modes/scan.md`) in the skill directory (`~/.config/opencode/skills/career-ops/modes/`). The skill router (`SKILL.md`) is not sufficient — the actual mode files must be present for the skill to function.

For Codex-specific setup, see `docs/CODEX.md`.
