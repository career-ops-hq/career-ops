# Scripts Reference

All scripts live in the project root as `.mjs` modules and are exposed via `npm run <name>`.

## Quick Reference

| Command | Script | Purpose |
|---------|--------|---------|
| `npm run doctor` | `doctor.mjs` | Validate setup prerequisites |
| `npm run verify` | `verify-pipeline.mjs` | Check pipeline data integrity |
| `npm run normalize` | `normalize-statuses.mjs` | Fix non-canonical statuses |
| `npm run dedup` | `dedup-tracker.mjs` | Remove duplicate tracker entries |
| `npm run merge` | `merge-tracker.mjs` | Merge batch TSVs into applications.md |
| `npm run pdf` | `generate-pdf.mjs` | Convert HTML to ATS-optimized PDF |
| `npm run img-to-pdf` | `img-to-pdf.mjs` | Convert a single screenshot/image into a single-page PDF |
| `npm run build:latex` | `build-cv-latex.mjs` | Build .tex from structured JSON payload |
| `npm run sync-check` | `cv-sync-check.mjs` | Validate CV/profile consistency |
| `npm run patterns` | `analyze-patterns.mjs` | Analyze tracker outcomes and report patterns |
| `npm run upskill` | `upskill.mjs` | Aggregate skill-gap map from tracked reports |
| `npm run add` | `add-entry.mjs` | Dedup + insert a `/career-ops add` entry into cv.md / article-digest.md |
| `npm run update:check` | `update-system.mjs check` | Check for upstream updates |
| `npm run update` | `update-system.mjs apply` | Apply upstream update |
| `npm run rollback` | `update-system.mjs rollback` | Rollback last update |
| `npm run liveness` | `check-liveness.mjs` | Test if job URLs are still active |
| `npm run extract` | `browser-extract.mjs` | Headless read-only page extractor (opt-in `scan.extractor: cli`) — compact JSON for scan/JD |
| `npm run scan` | `scan.mjs` | Zero-token portal scanner |
| `npm run scan:full` | `scan-ats-full.mjs` | Reverse ATS discovery scanner |
| `npm run validate:portals` | `validate-portals.mjs` | Validate portals.yml shape before scanning |
| `npm run tracker` | `tracker.mjs` | SQLite derived index over applications.md — sync/query/history/export |
| `npm run find` | `find.mjs` | Resolve a report#/tracker#/company query to its full pipeline identity |
| `npm run invite-match` | `invite-match.mjs` | Fuzzy-match a pasted interview-invite email against `data/applications.md` |
| `npm run paste-reply` | `paste-reply.mjs` | Manual/no-Gmail input into the `reply-watch.mjs` classification pipeline |
| `npm run openai:tailor` | `openai-tailor.mjs` | Tailor a CV via any OpenAI-compatible endpoint (headless companion to `openai-eval.mjs`) |

---

## doctor

Validates that all prerequisites are in place: Node.js >= 18, dependencies installed, Playwright chromium, required files (`cv.md`, `config/profile.yml`, `portals.yml`), fonts directory, and auto-creates `data/`, `output/`, `reports/` if missing.

```bash
npm run doctor
```

**Exit codes:** `0` all checks passed, `1` one or more checks failed (fix messages printed).

---

## verify

Health check for pipeline data integrity. Validates `data/applications.md` against nine rules: canonical statuses (per `templates/states.yml`), no duplicate company+role pairs, all report links point to existing files, scores match `X.XX/5` / `N/A` / `DUP`, rows have proper pipe-delimited format, no pending TSVs in `batch/tracker-additions/`, no markdown bold in scores, no two `reports/*.md` files covering the same company+role, and no orphan reports without a tracker row (#1425). The report checks are warning-level: duplicate reports can be legitimate (re-evaluation after a JD change), so they never fail the run.

```bash
npm run verify
```

**Exit codes:** `0` pipeline clean (zero errors), `1` errors found. Warnings (e.g. possible duplicates) do not cause a non-zero exit.

---

## normalize

Maps non-canonical statuses to their canonical equivalents and strips markdown bold and dates from the status column. Aliases like `Enviada` become `Aplicado`, `CERRADA` becomes `Descartado`, etc. DUPLICADO info is moved to the notes column.

```bash
npm run normalize             # apply changes
npm run normalize -- --dry-run  # preview without writing
```

Creates a `.bak` backup of `applications.md` before writing.

**Exit codes:** `0` always (changes or no changes).

---

## dedup

Removes duplicate entries from `applications.md` by grouping on normalized company name + fuzzy role match. Keeps the entry with the highest score. If a removed entry had a more advanced pipeline status, that status is promoted to the keeper.

```bash
npm run dedup             # apply changes
npm run dedup -- --dry-run  # preview without writing
```

Creates a `.bak` backup before writing.

**Exit codes:** `0` always.

---

## merge

Merges batch tracker additions (`batch/tracker-additions/*.tsv`) into `applications.md`. Handles 9-column TSV, 8-column TSV, and pipe-delimited markdown formats. Detects duplicates by report number, entry number, and company+role fuzzy match. Higher-scored re-evaluations update existing entries in place.

```bash
npm run merge                 # apply merge
npm run merge -- --dry-run    # preview without writing
npm run merge -- --verify     # merge then run verify-pipeline
```

Processed TSVs are moved to `batch/tracker-additions/merged/`.

**Exit codes:** `0` success, `1` verification errors (with `--verify`).

---

## validate:portals

Validates `portals.yml` before running the scanner. The validator is offline: it reads YAML, loads local provider IDs from `providers/*.mjs`, and checks common configuration mistakes without fetching any job boards.

It reports errors for invalid YAML shape, unknown explicit providers, malformed URLs, empty filter keywords, and invalid local parser blocks. Duplicate enabled company names are warnings because they may be intentional during migrations, but they are worth reviewing.

```bash
npm run validate:portals
npm run validate:portals -- --file templates/portals.example.yml
node validate-portals.mjs --self-test
```

**Exit codes:** `0` no errors (warnings allowed), `1` one or more errors found.

---

## pdf

Renders an HTML file to a print-quality, ATS-parseable PDF via headless Chromium. Resolves font paths from `fonts/`, normalizes Unicode for ATS compatibility (em-dashes, smart quotes, zero-width characters), and reports page count and file size.

```bash
npm run pdf -- input.html output.pdf
npm run pdf -- input.html output.pdf --format=letter   # US letter
npm run pdf -- input.html output.pdf --format=a4        # A4 (default)
```

**Exit codes:** `0` PDF generated, `1` missing arguments or generation failure.

---

## img-to-pdf

Converts a single screenshot or image (PNG, JPEG, GIF, WEBP, BMP, SVG) into a single-page PDF via headless Chromium — for ATS upload fields that require a PDF specifically and reject images. Embeds the image as a base64 `data:` URI in a minimal HTML page and renders it with `page.pdf()`, sized to the image's own pixel dimensions so the page is neither cropped nor padded. Zero new dependencies — reuses the `playwright` dependency `generate-pdf.mjs` already uses, and is a deliberately standalone script: it does not go through `generate-pdf.mjs`, so it is never subject to that script's cv.md section-order validation.

```bash
npm run img-to-pdf -- screenshot.png output.pdf
npm run img-to-pdf -- screenshot.png output.pdf --force   # overwrite an existing output file
node img-to-pdf.mjs --self-test
```

MVP scope: one image in, one PDF page out. Multi-image/multi-page conversion is not implemented.

**Exit codes:** `0` PDF generated, `1` missing arguments, unsupported image type, missing input file, existing output without `--force`, or generation failure.

---

## build:latex

Builds a `.tex` file from a structured JSON payload, handling template merge and LaTeX escaping automatically. The JSON is produced by the agent during evaluation — this script replaces the manual LaTeX generation step in `modes/latex.md`.

```bash
node build-cv-latex.mjs input.json output.tex
node build-cv-latex.mjs --test
```

**Exit codes:** `0` file generated, `1` missing inputs, invalid JSON, unresolved placeholders, or template not found.

---

## sync-check

Validates that the career-ops setup is internally consistent: `cv.md` exists and is not too short, `config/profile.yml` exists with required fields, no hardcoded metrics in `modes/_shared.md` or `batch/batch-prompt.md`, and `article-digest.md` freshness (warns if older than 30 days).

```bash
npm run sync-check
```

**Exit codes:** `0` no errors (warnings allowed), `1` errors found.

---

## patterns

Analyzes application outcomes, scores, archetypes, blockers, remote policy, and company size from `data/applications.md` and linked reports. New reports should include `## Machine Summary` YAML; `analyze-patterns.mjs` uses it first and falls back to legacy markdown parsing for older reports.

```bash
npm run patterns
npm run patterns -- --summary
npm run patterns -- --min-threshold 3
node analyze-patterns.mjs --self-test
```

**Exit codes:** `0` analysis succeeded, `1` insufficient data or parser self-test failure.

---

## upskill

Aggregates skill gaps across every tracked report (#1520, phase 1). Extracts skill tokens from each report's Machine Summary `hard_stops`/`soft_gaps` and Gap table, removes skills already present in `cv.md`/`config/profile.yml` (exact-alias matching only — an umbrella term never suppresses a specific skill), and weights each gap by inverse report score (`5.0 − score`, counted once per report). Tiers (Critical/High/Medium/Low) use fixed thresholds over the share of low-fit (score < 4.0) reports naming the gap. Output carries `schema_version` so the `upskill` mode's diff-vs-previous section never compares across extraction-rule changes, plus coverage stats (`reportsWithMachineSummary` vs `reportsRead`).

```bash
npm run upskill
npm run upskill -- --summary
npm run upskill -- --min-reports 3
node upskill.mjs --self-test
```

**Exit codes:** `0` analysis succeeded (including graceful `{error}` JSON for insufficient data), `1` self-test failure.

---

## salary-gap

Folds compensation observations into per-application desired/advertised/actual values and gap aggregates. Sources: `reports/*.md` Machine Summary `advertised_comp` (advertised, source `jd` — historical reports backfill automatically), `data/salary-observations.tsv` (desired/actual, append-only), and `config/profile.yml` `compensation.target_range` (desired default). Fold precedence: highest trust tier wins, then latest date (`actual`: contract > offer-letter > recruiter-verbal > user). Aggregates group by (company, role) and per currency — no FX conversion. Unparseable amounts, orphaned tracker numbers, sample sizes, and staleness are always reported.

```bash
node salary-gap.mjs             # JSON
node salary-gap.mjs --summary   # table + data-quality section
node salary-gap.mjs --self-test
```

Observation line format (TSV, one per line, `#`-prefixed lines are comments):

```text
{tracker#}\t{YYYY-MM-DD}\t{desired|advertised|actual}\t{amount}\t{currency}\t{source}\t{note}
```

Amounts: number + optional k/K suffix, ranges allowed ("80-90k"), annual gross unless noted. Sources: jd | profile | user | recruiter-verbal | offer-letter | contract.

**Exit codes:** `0` always (missing sources produce an explanatory empty result), `1` self-test failure.

---

## funnel-velocity

Funnel calibration vs market benchmarks + stage velocity. Three payloads, decreasing availability: **calibration** — your funnel rates (canonical `ever*` definition imported from `stats.mjs`) vs candidate-side benchmark ranges from `templates/benchmarks.yml` (override: `config/benchmarks.yml` or `--benchmarks <path>`); **waiting** — in-flight Applied rows and elapsed days vs the typical first-response window (per-row factual reporting; applied-date priority: status-log observation > `Applied YYYY-MM-DD` in tracker notes > unknown, never guessed); **velocity** — median/p75 days per stage hop (Applied→Responded→Interview→Offer, Applied→Rejected separate) folded from `data/status-log.tsv`.

Statistical honesty is enforced in code: right-censored counts printed next to every median ("n still waiting, excluded"), same-day catch-up hops excluded and counted, no comparative multiplier claims below n=20 applied, above-range output carries a selection-bias note, every benchmark mention carries its year + "directional". Coverage, orphaned tracker numbers, unparseable lines, and unknown sources are always reported.

```bash
node funnel-velocity.mjs             # JSON
node funnel-velocity.mjs --summary   # human-readable
node funnel-velocity.mjs --self-test
node funnel-velocity.mjs --benchmarks path/to/benchmarks.yml
```

Ledger line format (TSV, appended by `set-status.mjs`, `#`-prefixed lines are comments):

```text
{tracker#}\t{YYYY-MM-DD}\t{from}\t{to}\t{source}\t{note}
```

`from` may be `-` (unknown prior state); `to` = `-` retracts the row's latest observation; a later `correction`-source line with the same (tracker#, to) replaces the earlier observation's date. Sources: set-status | correction | backfill | manual (only set-status/correction feed day-math).

**Exit codes:** `0` always (missing tracker/ledger produce an explanatory empty result), `1` self-test or benchmarks-load failure.

---

## assessment-log

Logs "received a skills assessment" as a structured per-application event (eSkill, HackerRank, Criteria, Predictive Index, ...) instead of burying it in free-text notes. Each event records platform, subject tested, pass threshold vs score achieved (both optional — vendors often hide them), and a candidate-observed staleness note (e.g. "test content references Adobe Acrobat 9, a 2008-era version"; empty = no staleness observed). Events append to `data/assessments.tsv` (user layer, created on first `add`, never rewritten). Aggregates count events, pass/fail (only when both threshold and score are known), and stale-flagged events per platform; malformed lines are always reported, never dropped silently.

```bash
node assessment-log.mjs add --company Acme --report 042 --platform eSkill --subject "MS Office" --threshold 70 --score 92 --stale "references Adobe Acrobat 9 (2008-era)"
node assessment-log.mjs             # JSON
node assessment-log.mjs --summary   # per-event + per-platform table
node assessment-log.mjs --self-test
```

Log line format (TSV, one per line, `#`-prefixed lines are comments; for `report#`, `threshold%`, and `score%`, `-` or an absent trailing cell = unknown; an empty `stale_note` means no staleness was observed, not unknown):

```text
{YYYY-MM-DD}\t{company}\t{report#|-}\t{platform}\t{subject}\t{threshold%|-}\t{score%|-}\t{stale_note}
```

**Exit codes:** `0` success (a missing log produces an explanatory empty result), `1` invalid `add` arguments or self-test failure.

---

## update:check

Checks whether a newer version of career-ops is available upstream. Outputs JSON to stdout:

```bash
npm run update:check
```

Possible JSON responses:

| `status` | Meaning |
|----------|---------|
| `up-to-date` | Local version matches remote |
| `update-available` | Newer version exists (includes `local`, `remote`, `changelog`) |
| `dismissed` | User dismissed the update prompt |
| `offline` | Could not reach GitHub |

**Exit codes:** `0` always.

---

## update

Applies the upstream update. Creates a timestamped backup branch (`backup-pre-update-<version>-<YYYYMMDDTHHMMSSZ>`), fetches from the canonical repo, checks out only system-layer files, runs `npm install`, and commits. The timestamp is derived from UTC ISO time with separators and milliseconds removed (for example, `backup-pre-update-1.8.1-20260608T071302Z`). User-layer files (`cv.md`, `config/profile.yml`, `data/`, etc.) are never touched.

```bash
npm run update
```

**Exit codes:** `0` success, `1` lock conflict or safety violation.

---

## rollback

Restores system-layer files from the most recent backup branch created during an update. Rollback prefers the newest timestamped branch matching `backup-pre-update-<version>-<YYYYMMDDTHHMMSSZ>` and still accepts legacy `backup-pre-update-<version>` branches for older installs.

```bash
npm run rollback
```

**Exit codes:** `0` success, `1` no backup branch found or git error.

---

## liveness

Tests whether job posting URLs are still live using headless Chromium. Detects expired patterns (e.g. "job no longer available"), HTTP 404/410, ATS redirect patterns, and apply-button presence. Supports multi-language expired patterns (English, German, French).

```bash
npm run liveness -- https://example.com/job/123
npm run liveness -- https://a.com/job/1 https://b.com/job/2
npm run liveness -- --file urls.txt
```

Each URL gets a verdict: `active`, `expired`, or `uncertain` with a reason.

**Exit codes:** `0` all URLs active, `1` any expired or uncertain.

---

## scan

Zero-token portal scanner. Runs configured local parsers for SSR/static career pages and hits ATS APIs (Greenhouse, Ashby, Lever) directly — no LLM tokens consumed. Reads `portals.yml` for target companies, outputs matching listings to stdout, and optionally appends to `data/pipeline.md`.

`scan_history.recheck_after_days` in `portals.yml` lets old `added` URLs become eligible for recheck after the configured number of days. If absent, scan-history dedup keeps the historical behavior and dedups forever. Permanent invalid statuses such as blocked host and malformed URL remain permanent.

For custom SSR pages, configure a tracked company with `scan_method: local_parser` and a `parser` block. The parser can be written in JavaScript, Python, or any language available as a local executable. Company-specific parsers usually already know their source URL and only need to print JSON jobs to stdout:

```yaml
parser:
  command: node
  script: scripts/parsers/example-company-jobs.js
  format: jobs-json-v1
```

Use `args` only for reusable parsers that intentionally accept runtime parameters such as `{careers_url}` or `{company}`.

If a parser writes full extraction artifacts for debugging or audit, store them under `data/parser-output/{company}/`. `scan.mjs` reads stdout and does not require those JSON files after parsing. Keep generated JSON artifacts out of git; `.gitkeep` placeholders are the only exception for preserving directory structure.

When the ATS provider's list API returns a description, each new offer is fingerprinted for cross-listing detection. See [Cross-listing detection](#cross-listing-detection) under `scan:full` for details.

**Company blacklist (#1742):** if `data/blacklist.md` exists (user layer, opt-in — see `templates/blacklist.example.md`), postings from listed companies are skipped, matched case- and punctuation-insensitively with the same company normalization the tracker scripts share. Skips are never silent: the run summary reports `N skipped (blacklist)` and the count is persisted to `data/scan-runs.tsv` as `filtered_blacklist`. Pass `--include-blacklisted` to bypass the filter for auditing — matching postings flow through annotated (`note: blacklisted: {reason}` in `data/pipeline.md`). No blacklist file = no filtering; nothing ever adds a company to the list automatically.

```bash
npm run scan
node scan.mjs --include-blacklisted   # audit: let blacklisted companies through, annotated
```

**Exit codes:** `0` scan completed, `1` configuration error or no portals.yml found.

---

## scan:full

Reverse ATS discovery scanner. Where `scan.mjs` scans the companies you track in `portals.yml`, this inverts the direction: it walks public directories of companies per ATS (Greenhouse, Lever, Ashby, Workday) and surfaces fresh postings matching your `portals.yml` `title_filter` / `location_filter` — no manual company curation. Company directories come from the public [job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator) dataset, cached in `data/cache/` for 24 hours.

Postings without a usable publish date are skipped — a reverse scan is only useful for fresh postings. New matches are appended to `data/pipeline.md` and `data/scan-history.tsv` in the same format as `scan.mjs`.

### Cross-listing detection

`data/scan-history.tsv` carries a **SimHash fingerprint** of the JD text in its 8th column (`jd_fingerprint`), and the original posting date in its 9th column (`postedAt`). The fingerprint column exists to catch a specific double-submission hazard: the same role posted by the direct employer **and** by a recruitment agency, often with the employer name stripped from the agency listing. URL dedup and company+role dedup both miss this pair because the URLs and company names are different — but agencies rarely rewrite the requirements text, so a near-identical JD body is a reliable signal.

How it works:

- When the ATS provider's list API returns a description field (e.g. Lever's `descriptionPlain`), the scanner computes a **64-bit SimHash** of the normalized text and stores it as the 8th column.
- SimHash is locality-sensitive: near-duplicate texts land within a few bits of each other. The scanner flags any two rows from **different companies** whose fingerprints are ≥ 92 % similar (at most 5 of 64 bits differ) and that appeared within a 90-day window.
- The check is **warn-only**: nothing is dropped automatically. If one side is an agency, apply through ONE channel only — a double submission burns the candidate with both parties.
- Postings without a usable description get an **empty fingerprint** and are never flagged. No body → no signal, no false positives.
- The fingerprint is computed **locally** from the text already returned by the API. No extra network request is made and the JD body itself is not stored in the TSV.

Same detection logic applies to `scan.mjs` (the standard portal scanner) — the sub-section above is shared between both commands.

```bash
npm run scan:full                              # all ATS directories, last 3 days
node scan-ats-full.mjs --since 7               # postings from the last 7 days
node scan-ats-full.mjs --ats greenhouse,workday # subset of sources
node scan-ats-full.mjs --limit 200             # max companies per ATS
node scan-ats-full.mjs --dry-run               # preview without writing
node scan-ats-full.mjs --liveness              # Playwright-verify matches first
node scan-ats-full.mjs --md-out notes/scans    # also write a dated markdown digest
```

**Exit codes:** `0` scan completed, `1` configuration error (no portals.yml, unknown `--ats` source) or fatal scan error.

---

## tracker

SQLite **derived index** for the applications tracker (RFC #918, phase 1). `data/applications.md` stays the source of truth; `data/applications.db` is built from it by `sync` and is safe to delete at any time — it regenerates on the next sync. All writes keep going to the markdown exactly as today (`merge-tracker.mjs`, hand edits); the index is read-only infrastructure.

Why: at hundreds of rows a markdown table degrades structurally (encoding corruption, column drift, `|` inside cells shifting columns), and agents grepping it get model-dependent results. The index normalizes on sync, so a query returns the same rows for every model on every CLI — and corruption is detected at sync time instead of propagating silently.

Zero new dependencies — uses `node:sqlite`, built into Node ≥ 22.5.

```bash
node tracker.mjs sync                     # (re)build applications.db from applications.md
node tracker.mjs sync --check             # diagnose corruption only, no write (exit 1 if issues found)
node tracker.mjs query --status Applied --since 2026-05-01
node tracker.mjs query --company acme --json
node tracker.mjs history --id 42          # status transitions observed across syncs (Applied → Interview → ...)
node tracker.mjs export                   # inverse: index → canonical markdown table on stdout
node tracker.mjs export --out repaired.md # write to a file (existing file backed up to .bak first)
```

`query` and `history` auto-resync when the markdown changed since the last sync, so the index can never serve stale reads.

`sync` detects and reports the corruption classes markdown accumulates — mojibake placeholder cells, scores stranded in the status column, non-canonical statuses (resolved via `templates/states.yml` aliases), missing/duplicate ids, stray pipes — and normalizes them **in the index only**; the markdown is never modified. Fix at the source with `normalize-statuses.mjs` / `dedup-tracker.mjs`, then re-sync. Status changes between syncs accumulate in a `status_events` table, which gives `analyze-patterns.mjs` a real funnel instead of only the current snapshot.

`export` is the inverse of `sync` (round-trip `md → db → md` is lossless for clean input — enforced by `test-all.mjs`). It writes to stdout by default and never touches `applications.md` unless you explicitly pass it as `--out`. Phase 2 of #918 (DB becomes source of truth, markdown becomes a rendered view) is a separate, explicit per-user opt-in — not part of this script yet.

**Exit codes:** `0` success, `1` validation error, missing prerequisites (Node < 22.5, no `applications.md` to index), or corruption found by `sync --check`.

---

## find

Resolves a report number, tracker number, or company/role fragment to its full pipeline identity: company, role, tracker#, report#, canonical status, PDF path (from `data/pdf-index.tsv`), and report path. "Apply to #13" is ambiguous — report numbers and tracker row numbers diverge — and answering it used to require opening three files; this does it in one read-only lookup.

Zero dependencies, strictly read-only. Numeric queries match **both** the tracker # column and the report number from the Report link (`012` and `12` are the same number), so collisions between the two numbering schemes surface as multiple rows instead of a silent wrong pick. Text queries match company/role by case-insensitive substring, with the shared fuzzy matcher (`role-matcher.mjs`) as fallback for multi-word phrases.

```bash
node find.mjs 13                # report# OR tracker# 13 — shows both if they differ
node find.mjs acme              # company fragment
node find.mjs "data engineer"   # role phrase (fuzzy via role-matcher)
node find.mjs acme --json       # machine-readable output
```

Multiple matches print as a table; zero matches print a clean message.

**Exit codes:** `0` at least one match, `1` no match, missing query, or no `applications.md`.

---

## paste-reply

Manual, no-Gmail input path into `reply-watch.mjs`'s classification pipeline (#1802). `reply-watch.mjs` already classifies employer replies and matches them to tracker rows, but its only input is `data/reply-candidates.json`, and the only planned way to populate that file is a Gmail scanner (#1583, unbuilt, requires OAuth inbox-read access). `paste-reply.mjs` normalizes a pasted (or file-provided) email's subject/from/body into the exact candidate shape `reply-watch.mjs` expects and appends it — existing candidates are never overwritten. It does not classify the reply itself (that stays `reply-watch.mjs`'s job) and never runs `reply-watch.mjs` or touches `data/applications.md`.

```bash
npm run paste-reply                    # interactive: prompts for subject, from, body
node paste-reply.mjs --file email.txt  # read subject/from/body from a file
```

`--file` format (header lines optional, blank line separates headers from body):

```text
Subject: <subject line>
From: <sender>

<body text...>
```

If no `Subject:`/`From:` header lines are found, the whole file is treated as the body. After appending, run `node reply-watch.mjs` to classify the new candidate and review suggested tracker updates.

**Exit codes:** `0` candidate appended, `1` missing `--file` argument, input file not found, or no subject/body text found.

---

## stats.mjs

Aggregates lifetime pipeline stats into one JSON report. Stats include tracker, scanner, portals, follow-ups and runs. Reads from data/applications.md, data/scan-history.tsv, portals.yml, data/follow-ups.md and data/scan-runs.tsv. If a file doesn't exist yet, the section turns into null.

```bash
node stats.mjs --summary             # returns human-readable table
node stats.mjs                       # returns json
```
On a fresh clone, with no data yet, the JSON format is as follows:

```
{
  "metadata": {
    "generatedAt": "2026-07-07",
    "sources": {
      "tracker": false,
      "scanHistory": false,
      "followups": false,
      "portals": false,
      "scanRuns": false
    }
  },
  "tracker": null,
  "funnel": null,
  "scan": null,
  "portals": null,
  "followups": null,
  "runs": null
}
```

With --summary it returns:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pipeline Stats — 2026-07-07
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tracker:    — no data (data/applications.md missing)
Scanner:    — no data (data/scan-history.tsv missing)
Portals:    — no data (portals.yml missing)
Follow-ups: — no data (data/follow-ups.md missing)
Runs:       — no data (data/scan-runs.tsv missing; created by the next scan)
```

---

## data/scan-runs.tsv

`scan.mjs` appends one row to this file after each non-dry scan run, recording how many companies/boards it checked, how many postings it found vs. filtered out vs. flagged as duplicates vs. added, and how many errors occurred. `--dry-run` scans never write to this file. Stats appended include:

* `timestamp` — ISO timestamp of the scan
* `status` — always `completed` for now
* `companies` — number of companies scanned this run
* `boards` — number of job boards scanned this run
* `found` — total postings found
* `filtered_title` — filtered out by title mismatch
* `filtered_tier` — filtered out by tier
* `filtered_location` — filtered out by location
* `filtered_salary` — filtered out by salary
* `filtered_content` — filtered out by content
* `filtered_cooldown` — skipped because you recently applied to the same company + role and are still in the waiting period
* `dupes` — duplicate postings skipped
* `new_added` — new postings actually added to the pipeline
* `errors` — number of errors during the run
* `filtered_blacklist` — skipped because the company is on your `data/blacklist.md` do-not-apply list (#1742)

As the project is in continuous development, to parse for a stat we recommend doing it by column header instead of position.