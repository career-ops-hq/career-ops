# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (never touched by updates).

## User Layer (NEVER auto-updated)

These files contain your personal data, customizations, and work product. Updates will NEVER modify them.

| File | Purpose |
|------|---------|
| `cv.md` | Your CV in markdown |
| `config/profile.yml` | Your identity, targets, comp range |
| `config/cv-facts.json` | Your CV fact-check allowlist and forbidden phrases |
| `config/benchmarks.yml` | Your market calibration benchmark overrides (optional; copy `templates/benchmarks.yml` here and edit — read by `funnel-velocity.mjs`) |
| `modes/_profile.md` | Your archetypes, narrative, negotiation scripts |
| `modes/_custom.md` | Your house rules, custom workflows & output preferences (procedural — survives updates) |
| `voice-dna.md` | Your writing voice guardrail — banned words, anti-AI-slop rules, tone (optional) |
| `article-digest.md` | Your proof points from portfolio |
| `interview-prep/story-bank.md` | Your accumulated STAR+R stories |
| `interview-prep/{company}-{role}.md` | Company-specific interview prep reports (written by `/career-ops interview-prep`) |
| `interview-prep/sessions/*.md` | Interview sessions — real transcripts + mock sessions (sensitive: real names/companies; gitignored except scaffold). Drives `patterns` Step 1b targeting signal and `interview-redflag` analysis. Scaffold files (`README.md`, `.gitkeep`) are system-owned. |
| `portals.yml` | Your customized company list |
| `config/plugins.yml` | Your plugin activation toggles (opt-in; seeded from `config/plugins.example.yml`) |
| `plugins.local/` | Your own / private plugins (never auto-updated) |
| `plugins.lock` | Integrity pins + recorded consent for your enabled plugins (generated; never auto-updated) |
| `data/applications.md` | Your application tracker (source of truth) |
| `data/applications.db` | Derived query index over `applications.md` (SQLite, rebuilt by `node tracker.mjs sync` — safe to delete) |
| `data/pipeline.md` | Your URL inbox |
| `data/scan-history.tsv` | Your scan history (9 tab-separated columns; col 8: local SimHash JD fingerprint for cross-listing detection, col 9: posting date) |
| `data/scan-runs.tsv` | Your per-run scan counters (appended by `scan.mjs`, read by `stats.mjs`) |
| `data/portal-health.tsv` | Consecutive reachability status for scanned portals (appended by `scan.mjs`) |
| `data/follow-ups.md` | Your follow-up history |
| `data/offers/*` | Your received offers/contracts, promise notes, prep reports, and reply drafts (PII — gitignored, written by the `offer-prep` mode) |
| `data/salary-observations.tsv` | Your append-only compensation observation log: `{tracker#}\t{date}\t{desired\|advertised\|actual}\t{amount}\t{currency}\t{source}\t{note}`. Written by interactive modes when a figure is stated/confirmed; never edited in place. Advertised figures come from reports' `advertised_comp` instead — reports are themselves observation sources. Read by `salary-gap.mjs` |
| `data/status-log.tsv` | Your append-only status transition ledger: `{tracker#}\t{date}\t{from}\t{to}\t{source}\t{note}`. Appended by `set-status.mjs` on every real status change (the tracker stays the source of truth for *state*; the ledger records *when* transitions happened; the `set-status.mjs` append path lands with #1695 — until then this file may simply not exist); never edited in place — corrections are new `correction`-source lines. Read by `funnel-velocity.mjs` |
| `data/upskill/*` | Your skill-gap analysis reports (written by the `upskill` mode) |
| `data/blacklist.md` | Your do-not-apply company list (opt-in — absence = no filtering; never auto-populated: only you, or the agent on your explicit instruction, write to it. Respected by `scan.mjs` and the `auto-pipeline`/`oferta`/`apply` gates; never a scoring input) |
| `data/assessments.tsv` | Your append-only skills-assessment log: `{date}\t{company}\t{report#\|-}\t{platform}\t{subject}\t{threshold%\|-}\t{score%\|-}\t{stale_note}`. Appended by `node assessment-log.mjs add`; never edited in place. Empty stale_note = no staleness observed. Read by `assessment-log.mjs` |
| `writing-samples/*` | Your personal writing samples for style calibration (except `writing-samples/README.md`, which is system-owned documentation delivered by updates) |
| `reports/*` | Your evaluation reports |
| `output/*` | Your generated PDFs |
| `jds/*` | Your saved job descriptions |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Scoring system, global rules, tools |
| `modes/_custom.template.md` | Template seed for the user's `modes/_custom.md` |
| `modes/oferta.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/scan.md` | Portal scanner instructions |
| `modes/batch.md` | Batch processing instructions |
| `modes/apply.md` | Application assistant instructions |
| `modes/auto-pipeline.md` | Auto-pipeline instructions |
| `modes/contacto.md` | LinkedIn outreach instructions |
| `modes/email.md` | Formal application email draft instructions |
| `modes/deep.md` | Research prompt instructions |
| `modes/regional/*` | Regional market calibration modes |
| `modes/ofertas.md` | Comparison instructions |
| `modes/pipeline.md` | Pipeline processing instructions |
| `modes/project.md` | Project evaluation instructions |
| `modes/tracker.md` | Tracker instructions |
| `modes/training.md` | Training evaluation instructions |
| `modes/patterns.md` | Pattern analysis instructions |
| `modes/titles.md` | Adjacent job-title suggestion instructions |
| `modes/upskill.md` | Skill-gap analysis instructions |
| `modes/followup.md` | Follow-up cadence instructions |
| `modes/offer-prep.md` | Offer-stage contract reading companion instructions |
| `modes/interview/*` | Interview prep planning, practice, and debrief skills |
| `modes/de/*` | German language modes |
| `modes/fr/*` | French language modes |
| `modes/hi/*` | Hindi language modes |
| `modes/ja/*` | Japanese language modes |
| `modes/pl/*` | Polish language modes |
| `modes/pt/*` | Portuguese language modes |
| `modes/ru/*` | Russian language modes |
| `modes/heuristics/*` | Shared candidate-facing application heuristics |
| `CLAUDE.md` | Agent instructions (Claude Code) |
| `OPENCODE.md` | Agent instructions (OpenCode) |
| `GEMINI.md` | Legacy no-op context guard (prevents Antigravity duplicate imports) |
| `AGENTS.md` | Canonical agent instructions (imported by CLI-specific wrappers) |
| `*.mjs` | Utility scripts |
| `plugins/` | Bundled plugins + the plugin engine (opt-in external integrations) |
| `plugins.mjs` | Plugin CLI (list/run/available/add/new/enable/skill/trust/remove) |
| `plugins-registry/` | Curated community plugins, one `<id>.json` per plugin (the trust root) |
| `plugin-install.mjs` / `plugin-audit.mjs` / `validate-plugin-registry.mjs` | Plugin install/audit/registry-validation utilities |
| `config/plugins.example.yml` | Plugin activation template (seed for `config/plugins.yml`) |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.sh` | Batch orchestrator |
| `dashboard/*` | Go TUI dashboard |
| `templates/*` | Base templates |
| `fonts/*` | Self-hosted fonts |
| `.claude/skills/*` | Skill definitions (Claude Code) |
| `.opencode/skills/*` | Skill definitions (OpenCode) |
| `.qwen/skills/*` | Skill definitions (Qwen Code) |
| `.antigravitycli/skills/*` | Skill definitions (Antigravity CLI) |
| `.grok/skills/*` | Skill definitions (Grok Build CLI) |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |
| `writing-samples/README.md` | System-owned onboarding documentation for the writing-samples directory |

## The Rule

**If a file is in the User Layer, no update process may read, modify, or delete it.**

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**
