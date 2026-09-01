# Architecture

A high-level map of how career-ops is put together. For the precise system/user file boundary, see [DATA_CONTRACT.md](DATA_CONTRACT.md); for contribution mechanics, see [CONTRIBUTING.md](CONTRIBUTING.md); for runtime flow diagrams (evaluation steps, batch processing), see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Principles

Career-ops is built on three commitments that every design decision serves:

- **Local-first.** Everything runs on your machine against your files. No account required, no server in the loop for the core tool.
- **AI-agnostic.** The logic lives in Markdown prompt files under `modes/`, executed by whatever AI coding CLI you use (Claude Code, Codex, OpenCode, Gemini, Qwen, Grok, Antigravity) or by standalone Node scripts. No single model is hardcoded.
- **Human-in-the-loop.** The tool prepares and evaluates; the human reviews and clicks. It never submits applications on your behalf.

## The two layers (the data contract)

The single most important architectural rule: **system files** and **user files** are strictly separated.

- **System layer** — the tool itself: `modes/`, scripts (`*.mjs`), templates, the dashboard. These are versioned and updated by `update-system.mjs`. Listed in `SYSTEM_PATHS`.
- **User layer** — your data: `cv.md`, `config/profile.yml`, `modes/_profile.md`, `data/`, `reports/`, `jds/`, etc. The updater **never** touches these. Listed in `USER_PATHS`.

`DATA_CONTRACT.md` is the source of truth for this boundary, and `updater-migration-tests.mjs` enforces that no system path ever overlaps a user path.

## Files are canonical — databases are derived

Settled doctrine ([#918](https://github.com/career-ops-hq/career-ops/issues/918)): the human-readable, git-diffable files (`data/applications.md`, `reports/`, `data/pipeline.md`) are the **permanent source of truth**. SQLite exists only as a derived index (fast queries, reindex-on-delete) and will never become a primary store — not even opt-in. The reason is ecosystem-wide: the web UI, the Go dashboard, community plugins, and thousands of fork scripts all read the files; a second canonical store would force every reader to support two modes forever. Performance work is welcome **on the derived layer**; the files stay the brain.

## Why the flat root

The repo keeps its ~70 scripts at the root deliberately ([#1386](https://github.com/career-ops-hq/career-ops/issues/1386)). Path stability is a feature here, not an accident: the updater's `SYSTEM_PATHS` allowlist, community plugins, docs, guides, and the muscle memory of thousands of users (`node scan.mjs`) all reference these paths. A cosmetic reorganization would break forks and plugins for no functional gain. The conventions that keep the flat root navigable: one script = one job, and every script is registered in `SYSTEM_PATHS` (enforced in CI by the coverage guard).

Tests are the one thing the flat root does not hold. Suites live in `tests/`, named `{module}.test.mjs` for the root script they cover, and `test-all.mjs` discovers `tests/**/*.test.mjs` — no registration list, so a new suite runs the moment it is written and a typo cannot silently turn CI green ([#1440](https://github.com/career-ops-hq/career-ops/issues/1440)). Write new ones there; `*.test.mjs` at the repo root is not discovered and will not run.

Discovery imports a suite in-process and shares its counters; a `node:test` suite is child-processed instead, so its results survive ([#2828](https://github.com/career-ops-hq/career-ops/issues/2828)). A discovered suite therefore reports through `pass`/`fail` from `tests/helpers.mjs` and never calls `process.exit()` or `finish()`, both of which would forge the run's verdict.

This was three arrangements until recently — `tests/`, a `test/` directory, and suites sitting beside the scripts they covered — with the latter two registered by hand in `test-all.mjs`. Hand registration meant three suites shipped in `SYSTEM_PATHS` to every install while running nowhere ([#3247](https://github.com/career-ops-hq/career-ops/issues/3247), [#3303](https://github.com/career-ops-hq/career-ops/issues/3303)), which is what consolidated them ([#3306](https://github.com/career-ops-hq/career-ops/issues/3306)). No suite is registered by hand any more — `test-all.mjs`'s `SCRIPTS` list holds scripts and their `--self-test` entry points, not test files. Playwright specs are the deliberate exception: `tests/cv-visual/` is named `*.spec.mjs`, which discovery does not match, and runs from `playwright.cv.config.mjs`.

## Component map

```
AI coding CLI  ─┐
(or scripts)    │  reads prompt files
                ▼
   modes/*.md  ──────────────►  the "brain": scoring, evaluation,
   (_shared.md = scoring core)   apply, scan, interview, etc. prompts
                │
   ┌────────────┼─────────────────────────────────────────────┐
   ▼            ▼                  ▼               ▼            ▼
 scan        evaluate          generate         track       update
 scan.mjs    oferta.md         PDFs/CVs/        data/        update-
 providers/  (+eval scripts)   cover letters    reports/     system.mjs
```

### Discovery — `scan.mjs` + `providers/`
Finds jobs from **open, no-auth public sources**. `scan.mjs` is zero-token: it calls public ATS APIs (Greenhouse, Ashby, Lever, BambooHR, Teamtailor, Workday, Breezy) and RSS/JSON boards via per-board modules in `providers/`. Auth-gated/login-required sources are intentionally out of core (they belong in the plugin layer). Results land in `data/pipeline.md`.

### Evaluation — `modes/oferta.md` + `modes/_shared.md`
The heart of the tool. `oferta.md` defines the A–H evaluation blocks (H is conditional, on scores of 4.5 and above); `_shared.md` defines the 1–5 scoring system, archetype detection, posting-legitimacy signals, and global rules. The AI reads these plus your `cv.md` and produces a structured report.

**Standalone evaluators** let you run the same scoring without an interactive CLI, against cheaper/local models: `gemini-eval.mjs` (Google free tier), `ollama-eval.mjs` (fully local), and `openai-eval.mjs` (any OpenAI-compatible endpoint).

### Generation — PDFs, CVs, cover letters
`generate-pdf.mjs` (Playwright HTML→PDF), `generate-latex.mjs` / `build-cv-latex.mjs`, `generate-cover-letter.mjs`. ATS-safe templates live in `templates/` and `fonts/`.

### Tracking — `data/` + `reports/` + tracker scripts
Every evaluated offer is registered. `data/applications.md` is the canonical tracker table; `reports/{NNN}-{company}-{date}.md` holds full evaluations. `tracker.mjs`, `merge-tracker.mjs`, `dedup-tracker.mjs`, `normalize-statuses.mjs`, and `reconcile-pipeline.mjs` keep it consistent (atomic writes + a SQLite index). Report numbers are claimed atomically via `reserve-report-num.mjs`.

### Liveness — never evaluate a dead posting
`check-liveness.mjs` / `liveness-*.mjs` verify a posting is still open (zero-token) before it costs evaluation time.

### Self-update — `update-system.mjs`
Safely pulls new system files from upstream without touching user data. It backs up, fetches, re-execs the target updater (resolving its import closure so a new import can't break the upgrade), then checks out only `SYSTEM_PATHS`. `BOOTSTRAP_PATHS` covers very old installs.

### Multi-CLI entry files
Each CLI reads its own entry file, all of which point at the canonical `AGENTS.md`: `CLAUDE.md` (full), and thin `@AGENTS.md` redirect wrappers `OPENCODE.md`, `CODEX.md`, `GEMINI.md`, plus the `.agents/skills/` skill entrypoints. This is the [open agent skill standard](https://agentskills.io).

### Dashboard (optional)
A standalone Go TUI under `dashboard/` for browsing the pipeline. Isolated from the core — never required.

## Data flow (a typical run)

```
scan ──► data/pipeline.md ──► evaluate (oferta + cv) ──► reports/NNN-*.md
                                          │                      │
                                          └──► data/applications.md (tracker)
                                                         │
                                          apply (human reviews + clicks)
```

## Quality gates

- `test-all.mjs` — the full suite (500+ checks across scoring, scan, tracker, PDF, security, updater).
- `updater-migration-tests.mjs` — enforces the system/user boundary and safe cross-version upgrades.
- CI: `test` + CodeQL are required; CodeRabbit reviews every PR; Renovate keeps deps current.

## Where to start reading

- The boundary → `DATA_CONTRACT.md`
- The scoring → `modes/_shared.md` + `modes/oferta.md`
- Adding a job source → [`providers/README.md`](providers/README.md)
- The updater → `update-system.mjs`
