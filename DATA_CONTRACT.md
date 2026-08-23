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
| `config/local-paths.txt` | Files *this clone* owns that upstream does not ship — one repo-relative path per line (optional; copy `config/local-paths.example.txt` here and edit). See [Fork-local paths](#fork-local-paths) below |
| `modes/_profile.md` | Your archetypes, narrative, negotiation scripts |
| `modes/_custom.md` | Your house rules, custom workflows & output preferences (procedural — survives updates) |
| `modes/_brief.md` | Your compact profile brief (~1.5–2K tokens) read by the two-pass triage first pass |
| `voice-dna.md` | Your writing voice guardrail — banned words, anti-AI-slop rules, tone (optional) |
| `article-digest.md` | Your proof points from portfolio |
| `interview-prep/story-bank.md` | Your accumulated STAR+R stories |
| `interview-prep/{company}-{role}.md` | Company-specific interview prep reports (written by `/career-ops interview-prep`) |
| `interview-prep/sessions/*.md` | Interview sessions — real transcripts + mock sessions (sensitive: real names/companies; gitignored except scaffold). Drives `patterns` Step 1b targeting signal and `interview-redflag` analysis. Scaffold files (`README.md`, `.gitkeep`) are system-owned. |
| `documents/*` | Your profile intake sources — master CV, LinkedIn export, diplomas, reference letters (PII — gitignored except scaffold; read locally by `intake.mjs`, see `modes/intake.md`). Scaffold files (`README.md`, `.gitkeep`) are system-owned. |
| `data/.hired-share-state.json` | Hired Wall ask-state (asked/shared/later/never per hire) — the anti-nag memory; never committed, never read by anything but `hired-share.mjs` |
| `data/intake-state.json` | Fingerprints of already-ingested intake sources (written by `node intake.mjs --commit`; makes re-runs propose only new material — safe to delete, next intake re-proposes everything) |
| `portals.yml` | Your customized company list |
| `config/plugins.yml` | Your plugin activation toggles (opt-in; seeded from `config/plugins.example.yml`) |
| `opencode.json` | Your OpenCode project config (MCP servers, model, formatter, LSP) — gitignored, copy `opencode.example.json` to start |
| `plugins.local/` | Your own / private plugins (never auto-updated) |
| `plugins.lock` | Integrity pins + recorded consent for your enabled plugins (generated; never auto-updated) |
| `data/applications.md` | Your application tracker (source of truth) |
| `data/applications.db` | Derived query index over `applications.md` (SQLite, rebuilt by `node tracker.mjs sync` — safe to delete) |
| `data/pipeline.md` | Your URL inbox |
| `data/scan-history.tsv` | Your scan history (tab-separated, append-only trailing columns; col 8: local SimHash JD fingerprint for cross-listing detection, col 9: posting date, cols 10-11: trust score/flags, col 12: normalized company key for repost/name matching). Older rows may have fewer columns — readers index by position and tolerate the absence. |
| `data/scan-runs.tsv` | Your per-run scan counters (appended by `scan.mjs`, read by `stats.mjs`) |
| `data/portal-health.tsv` | Consecutive reachability status for scanned portals (appended by `scan.mjs`; statuses: `reachable`, `empty`, `slug_gone`, `network`, `auth`, `server`, `unknown` — the last three joined the vocabulary later, so older files carry only the first four) |
| `data/dead-boards.tsv` | Boards that returned three consecutive 404s during mass reverse ATS sweeps (written by `scan-ats-full.mjs`; unlike `data/portal-health.tsv`, this does not track the user's configured portals; re-probed after 30 days — safe to delete, the next sweep rebuilds it) |
| `data/follow-ups.md` | Your follow-up history |
| `data/active-interviews.md` | Your active interview processes, incl. inline `[process-friction]` notes (read by `process-quality.mjs`) |
| `data/agent-inbox.md` | Your append-only request queue drained at session start (written by `agent-inbox.mjs`) |
| `data/reply-candidates.json` | Your normalized employer-reply candidates (subject, body, sender, signal — read by `reply-watch.mjs`) |
| `data/pdf-index.tsv` | PDF↔report linkage manifest (written by `generate-pdf.mjs`, read by `find.mjs`, the dashboard, and the `email` mode) |
| `data/offers/*` | Your received offers/contracts, promise notes, prep reports, and reply drafts (PII — gitignored, written by the `offer-prep` mode) |
| `data/outcomes/*` | Your application outcome logs and archived application artifacts (written by the `outcome` mode) |
| `data/salary-observations.tsv` | Your append-only compensation observation log: `{tracker#}\t{date}\t{desired\|advertised\|actual}\t{amount}\t{currency}\t{source}\t{note}`. Written by interactive modes when a figure is stated/confirmed; never edited in place. Advertised figures come from reports' `advertised_comp` instead — reports are themselves observation sources. Read by `salary-gap.mjs` |
| `status-log.tsv` (sibling of the active tracker file — `data/status-log.tsv` in the default layout) | Your append-only status transition ledger: `{tracker#}\t{date}\t{from}\t{to}\t{source}\t{note}`. Appended by `set-status.mjs` next to wherever the tracker lives, on every real status change (the tracker stays the source of truth for *state*; the ledger records *when* transitions happened); never edited in place — corrections are new `correction`-source lines. An unknown from- or to-state is the sentinel `-`, never an empty cell; the two columns then diverge, with a from of `-` parsing to null (no prior state) and a to of `-` preserved as the literal unknown-target sentinel, while an empty cell is rejected as `unknown from-state ""` or `unknown to-state ""` for its own column. The source column is a closed set whose members are `VALID_SOURCES` in `funnel-velocity.mjs` — that declaration is the authority, so this contract points at it rather than restating a list that goes stale the next time a writer is added. Any value outside the set parses but is counted as an unknown source and excluded from the funnel, so per-writer detail belongs in the note column rather than namespaced onto the source. Read by `funnel-velocity.mjs` and `company-history.mjs` |
| `data/upskill/*` | Your skill-gap analysis reports (written by the `upskill` mode) |
| `data/blacklist.md` | Your do-not-apply company list (opt-in — absence = no filtering; never auto-populated: only you, or the agent on your explicit instruction, write to it. Respected by `scan.mjs` and the `auto-pipeline`/`oferta`/`apply` gates; never a scoring input) |
| `data/assessments.tsv` | Your append-only skills-assessment log: `{date}\t{company}\t{report#\|-}\t{platform}\t{subject}\t{threshold%\|-}\t{score%\|-}\t{stale_note}`. Appended by `node assessment-log.mjs add`; never edited in place. Empty stale_note = no staleness observed. Read by `assessment-log.mjs` |
| `data/contacts.tsv` | Your job-search phonebook (third-party PII — gitignored): `{name}\t{company}\t{type}\t{title}\t{phone}\t{email}\t{linkedin}\t{tracker#\|-}\t{notes}`. `type` optional; when present must be one of the enum (recruiter\|hiring-manager\|peer\|interviewer\|other), else flagged in `quality`. Written by the `contacto` mode only after you confirm; lines are updated in place when a contact's details change (unlike the append-only salary log). Read by `contacts.mjs` |
| `data/Connections.csv` | Your LinkedIn connections export (third-party PII — gitignored, never committed, never touched by the updater). Placed here by you: LinkedIn → Settings → Data Privacy → Get a copy of your data → Connections. Read fresh on every run by `linkedin-join.mjs`, which writes no cache, index or sidecar state, so the file is disposable — delete it after use and re-export when you need it again. Never enters a prompt and never leaves the machine; only rows you paste by hand reach `data/contacts.tsv` |
| `writing-samples/*` | Your personal writing samples for style calibration (except `writing-samples/README.md`, which is system-owned documentation delivered by updates) |
| `reports/*` | Your evaluation reports |
| `output/*` | Your generated PDFs |
| `jds/*` | Your saved job descriptions |

### Fork-local paths

The two lists above describe *this project*. A fork usually carries files the project has never heard of — a nightly runner, an `.mcp.json`, a private fixtures directory. Those files are in the user layer by every definition that matters, but they cannot be added to `USER_PATHS`: that array lives in `update-system.mjs`, which `apply` overwrites and which git re-merges on every sync. The declaration would be erased by the process it exists to constrain.

`config/local-paths.txt` moves the declaration outside that blast radius. It is gitignored, read at runtime, and merged into the user layer for both the updater's safety check and `validate-system-paths-coverage.mjs`:

```text
# one repo-relative path per line; blank lines and # comments ignored
run-nightly.ps1
.mcp.json
qa-fixtures/          # trailing slash = everything under this directory
```

Absent file means no extra paths — identical to the behaviour of every install that never creates one.

Three declarations are refused, loudly, naming the entry:

| Refused | Why |
|---------|-----|
| An absolute path, or one containing `..` | Would extend "never touch" over files outside the checkout |
| A path the system layer already ships | The file would silently stop receiving updates, with no other signal that it had been frozen |
| `config/local-paths.txt` itself | It is gitignored, so nothing updates it; listing it protects against a threat that does not exist and reads as though it did |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Eval-core: scoring system, global rules, tools |
| `modes/_writing.md` | Writing guardrails (Voice DNA / Writing Style / ATS) — loaded by the CV/cover/apply writing modes, not by evaluation (#1710) |
| `modes/_custom.template.md` | Template seed for the user's `modes/_custom.md` |
| `modes/_profile.template.md` | Template seed for the user's `modes/_profile.md` |
| `modes/_brief.template.md` | Template seed for the user's `modes/_brief.md` |
| `modes/oferta.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/cover.md` | Cover letter generation instructions |
| `modes/latex.md` | LaTeX/Overleaf CV export instructions |
| `modes/text.md` | Tailored markdown CV instructions |
| `modes/add.md` | CV addition (project/paper/role) instructions |
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
| `modes/interview.md` | Interactive profile/CV onboarding interview instructions |
| `modes/interview-prep.md` | Company-specific interview prep instructions |
| `modes/interview-redflag.md` | Company red-flag detection instructions |
| `modes/outcome.md` | Application outcome instructions |
| `modes/interview/*` | Interview prep planning, practice, and debrief skills |
| `modes/agent-inbox.md` | Agent inbox (queued requests) instructions |
| `modes/reply-watch.md` | Employer reply classification instructions |
| `modes/update.md` | System update instructions |
| `modes/ar/*` | Arabic language modes |
| `modes/da/*` | Danish language modes |
| `modes/de/*` | German language modes |
| `modes/es/*` | Spanish language modes |
| `modes/fr/*` | French language modes |
| `modes/hi/*` | Hindi language modes |
| `modes/id/*` | Indonesian language modes |
| `modes/it/*` | Italian language modes |
| `modes/ja/*` | Japanese language modes |
| `modes/ko/*` | Korean language modes |
| `modes/nl/*` | Dutch language modes |
| `modes/pl/*` | Polish language modes |
| `modes/pt/*` | Portuguese language modes |
| `modes/ru/*` | Russian language modes |
| `modes/tr/*` | Turkish language modes |
| `modes/ua/*` | Ukrainian language modes |
| `modes/zh/*` | Chinese language modes |
| `modes/heuristics/*` | Shared candidate-facing application heuristics |
| `CLAUDE.md` | Agent instructions (Claude Code) |
| `OPENCODE.md` | Agent instructions (OpenCode) |
| `CODEX.md` | Agent instructions (Codex) |
| `KIMI.md` | Agent instructions (Kimi CLI) |
| `GEMINI.md` | Legacy no-op context guard (prevents Antigravity duplicate imports) |
| `AGENTS.md` | Canonical agent instructions (imported by CLI-specific wrappers) |
| `*.mjs` | Utility scripts |
| `providers/` | Job-source provider modules for the zero-token scanner |
| `plugins/` | Bundled plugins + the plugin engine (opt-in external integrations) |
| `plugins.mjs` | Plugin CLI (list/run/available/add/new/enable/skill/trust/remove) |
| `plugins-registry/` | Curated community plugins, one `<id>.json` per plugin (the trust root) |
| `plugin-install.mjs` / `plugin-audit.mjs` / `validate-plugin-registry.mjs` | Plugin install/audit/registry-validation utilities |
| `config/plugins.example.yml` | Plugin activation template (seed for `config/plugins.yml`) |
| `opencode.example.json` | OpenCode project config template (seed for `opencode.json`; ships Playwright MCP registration) |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.sh` | Batch orchestrator |
| `dashboard/*` | Go TUI dashboard |
| `templates/*` | Base templates |
| `fonts/*` | Self-hosted fonts |
| `.claude/skills/*` | Skill definitions (Claude Code) |
| `.cursor/skills/*` | Skill definitions (Cursor) |
| `.opencode/skills/*` | Skill definitions (OpenCode) |
| `.qwen/skills/*` | Skill definitions (Qwen Code) |
| `.antigravitycli/skills/*` | Skill definitions (Antigravity CLI) |
| `.grok/skills/*` | Skill definitions (Grok Build CLI) |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |
| `writing-samples/README.md` | System-owned onboarding documentation for the writing-samples directory |
| `seed-fixture.mjs` / `test-fixtures/*` | Upgrade-test fixtures and seeder (system layer; fictional data, never user data) |
| `upgrade-tests.mjs` | Dynamic upgrade regression harness (PR gate: old install applies the commit under test hermetically) |

## The Rule

**If a file is in the User Layer, no update process may read, modify, or delete it.**

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**

## Custom Data Directory

By default, all User Layer files reside inside the project repository root. You can configure a separate, external directory for your personal data.

### Resolution Precedence:
1. **Environment Variables (`CAREER_OPS_ROOT` or `CAREER_OPS_DATA_DIR`):** Set this to the absolute or relative path of your custom data directory.
2. **Marker File (`.career-ops-data`):** A repository-level marker file named `.career-ops-data` containing the path (absolute or relative) to the user data directory.
3. **Repository Default:** Defaults to the codebase/repository root directory.

When resolved, all User Layer files/directories (e.g. `cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `data/`, `reports/`, `output/`, `portals.yml`) will be resolved relative to that path. System Layer files continue to be resolved relative to the codebase/repository root, keeping code and personal data completely separate.

### Tracker Path & Writes:
- **`CAREER_OPS_TRACKER`** can be set to override the applications tracker file path directly (relative paths are resolved relative to the repository root).
- **Read Resolution:** If no tracker override is set, reading resolves to `{DATA_ROOT}/data/applications.md` if it exists; otherwise falls back to `{DATA_ROOT}/applications.md`.
- **Write Resolution:** All writes (including merge operations and first-run creation) target the canonical location `{DATA_ROOT}/data/applications.md`.


