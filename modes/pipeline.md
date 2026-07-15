# Mode: pipeline — URL Inbox (Second Brain)

Process job URLs stored in `data/pipeline.md`. The user adds URLs at any time and then executes `/career-ops pipeline` to process them all.

## Liveness sweep

**Run this before processing any URLs.** Entries added by the scanner in headless/batch mode carry `**Verification:** unconfirmed (batch mode)` because Playwright was unavailable at scan time — they were never checked for liveness. Without a sweep, dead postings reach evaluation one tab at a time, burning time and tokens on phantom roles (a single inbox of 8 stale URLs produces 8 wasted evaluations).

Sweep all pending URLs in one batch with the zero-token liveness checker before the per-URL loop:

1. Collect every `- [ ]` URL from the "Pending" section into a temp file (one URL per line).
2. Run `node check-liveness.mjs --file <tmpfile>` (add `--throttle` for large batches to stay under WAF rate limits; it's pure Playwright, zero Claude tokens). The checker prints a per-URL verdict and exits non-zero if any are expired/uncertain.
3. For every URL the checker reports as **expired/closed**, resolve the pipeline entry instead of processing it: move it to "Processed" as `- [x] ~~URL | Company | Role~~ — posting expired (liveness sweep)` and, if it already has a tracker row, mark it `Discarded`. **Do not** extract the JD, evaluate, or generate a report/PDF for it.
4. Leave `uncertain` results in place to be confirmed during normal per-URL extraction (a transient timeout shouldn't drop a possibly-live posting).
5. Only the surviving live URLs continue to the per-URL processing loop below.

This complements — does not replace — the per-URL liveness gate in `auto-pipeline` (Step 0.5) and the `apply` preflight: the sweep drops the dead postings up front, in bulk, so the user never opens a tab or spends a token on them.

## Pre-screen gate (standard / premium tiers only)

Read `spend_tier` from `config/profile.yml` (see `modes/_shared.md` -- Spend Tier section; defaults to `standard` if absent).

- **`standard` or `premium` tier:** Before running the full A-F evaluation on a pending URL that survived the liveness sweep, run a cheap pre-screen pass using the tier's economy-equivalent model (see the mapping table in `modes/_shared.md`) against the candidate's North Star archetypes (`modes/_profile.md`). If the JD is an obvious mismatch, skip the full evaluation: mark it `- [x] #-- | {url} | skipped (pre-screen mismatch: {reason})` in "Processed" and continue to the next URL.
- **`economy` tier:** No gate. The tier is already the cheapest available. Every surviving pending URL goes straight to the full evaluation.
- This gate only applies to pipeline/batch processing. It never applies to a single interactive evaluation.

**Discard log (auditable):** Every posting the gate filters out MUST be logged with a one-line reason so pre-filtering is never a silent black box. Append one line to `data/discard.log` (create the file if absent) in the format `{ISO8601 timestamp}\t{url}\t{reason}` (three tab-separated fields — interactive pipeline mode has no batch job ID, so the `id` field is omitted here; batch mode's `batch/batch-runner.sh` uses a separate `batch/logs/discard.log` with a four-field format that includes the job ID), in addition to the `skipped` entry already written to "Processed" above. This log is the visible, auditable record of what the gate discarded and why -- review it periodically to tune the North Star archetypes if the gate is too aggressive or too lax.

## Workflow

1. **Read** `data/pipeline.md` → search for `- [ ]` items in the "Pending" section. Run the **Liveness sweep** (above) first and drop any expired entries before continuing.
2. **For each surviving pending URL**:
   a. **Extract JD** using Playwright (browser_navigate + browser_snapshot) → WebFetch → WebSearch
   b. If the URL is not accessible → mark as `- [!]` with a note and continue
   c. **Pre-screen gate**: apply the gate above (using the extracted JD). If the JD is an obvious mismatch, log the discard to `data/discard.log` (per the **Discard log** rule above — three fields, no job ID in interactive mode), mark it `- [x] #-- | {url} | skipped (pre-screen mismatch: {reason})` in "Processed", and continue to the next URL. No `REPORT_NUM` is claimed for discarded postings.
   d. Claim the next sequential `REPORT_NUM` atomically by running `node reserve-report-num.mjs` (and release the sentinel using `node reserve-report-num.mjs --release <num>` after the report is written)
   e. **Execute full auto-pipeline**: Evaluation A-F → Report .md → PDF (if score >= `auto_pdf_score_threshold`) → Tracker. Read `modes/_custom.md` → Pipeline Rules, if it exists, and apply its override here. Default (if absent or silent): standard pipeline execution.
   f. **Move from "Pending" to "Processed"**: `- [x] #NNN | URL | Company | Role | Score/5 | PDF ✅/❌`

   **About the PDF gate (configurable):** Read `config/profile.yml` → `auto_pdf_score_threshold`. If the key does not exist, default to `3.0` (this mode's original gate). If the evaluation score is less than the threshold, skip PDF generation: write the report normally, show in the header `**PDF:** not generated — run /career-ops pdf {company-slug} to create on demand`, and mark PDF ❌ in the tracker. If the score is ≥ threshold, generate the PDF as usual.

   **Tuning it:** Generating a tailored PDF costs ~30–60s per entry (Playwright launch + HTML render) and produces files that often go unused — most roles score in the 2.x/3.x range and never reach the application stage. Raise `auto_pdf_score_threshold` (e.g. `4.0`) to write only the report for marginal offers and produce the PDF on demand via `/career-ops pdf {slug}`; set `0` to generate one for every offer. Both modes (Path A `/career-ops pipeline` and Path B `batch/batch-runner.sh`) read the same key, so behavior is identical regardless of which path processes an offer.
3. **If there are 3+ pending URLs**, launch agents in parallel (Agent tool with `run_in_background`) to maximize speed — at most one agent per pending URL. Each is a **single-pass worker**: it evaluates its one URL and must **not** spawn further subagents or invoke other skills; its company/comp research stays inline and bounded (see `modes/_shared.md` → Subagent delegation). This keeps a pipeline run from fanning out into a recursive agent swarm.
4. **At the end**, show summary table:

```
| # | Company | Role | Score | PDF | Recommended action |
```

## Format of pipeline.md

```markdown
## Pending
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Inc | Senior PM
- [ ] https://jobs.ashbyhq.com/acme/789 | Acme Corp | Solutions Architect | Remote (US)
- [ ] https://jobs.ashbyhq.com/acme/790 | Acme Corp | AI Engineer | Remote (US) | 180000-220000 USD
- [ ] https://jobs.ashbyhq.com/acme/791 | Acme Corp | Staff PM | note: curated shortlist
- [ ] https://boards.greenhouse.io/acme/jobs/792 | Acme Corp | Backend Engineer | Remote (US) | posted: 2026-06-18
- [!] https://private.url/job — Error: login required

## Processed
- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | AI PM | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF ❌
```

Pending lines are variable-width. The rawest form is a bare pasted URL,
`- [ ] {url}` (1 column) — what you drop into the inbox by hand. Scanner-written
entries add `| {company} | {title}` (3 columns) plus two optional trailing
columns: `| {location}` (4th) and `| {compensation}` (5th). The scanner fills the
trailing columns only when the ATS exposes them, so 1-, 3-, 4-, and 5-column rows
are all valid — `{url} | {company} | {title} | {location} | {compensation}` is the
maximum (canonical) shape, not the only one. The columns are positional, so a row
carrying compensation always includes the location cell (empty if unknown); a row
with only a location stays 4 columns. Existing shorter rows remain valid and are
read as having empty values for the missing trailing columns.

Beyond the positional cells, rows may carry optional **labeled** segments —
`| {label}: {value}` — that ride on any row shape (bare URL, 3-, 4-, or 5-column),
because the `{label}:` prefix identifies them regardless of column position. Two
are defined:

- `| posted: {YYYY-MM-DD}` — the posting date, when the provider's API exposed one
  (`offer.postedAt`). The scanner writes it so freshness is visible at triage time
  without re-fetching the ATS. Rows from providers with no posting date simply omit
  the segment.
- `| note: {text}` — a free-text ranking signal an importer attached to the offer
  (`- [ ] {url} | {company} | {title} | note: curated shortlist` is valid). The
  deterministic scanner never sets it.

Treat both as hints when triaging; neither changes how you process the URL.

## Intelligent JD detection from URL

1. **Playwright (preferred):** `browser_navigate` + `browser_snapshot`. Works with all SPAs.
   - **Opt-in — CLI extractor (`scan.extractor: cli` in `config/profile.yml`):** run `node browser-extract.mjs <url>` (default `--mode jd`) instead; it returns compact `{ "url", "title", "text" }` — the JD main text at ~4–5× fewer tokens than a full snapshot. Use its `text` as the JD. **Fall back silently** to `browser_navigate` + `browser_snapshot` if it errors or is missing.
2. **WebFetch (fallback):** For static pages or when Playwright is unavailable.
3. **WebSearch (last resort):** Search in secondary portals that index the JD.

**Special cases:**
- **LinkedIn**: May require login → mark `[!]` and ask the user to paste the text
- **PDF**: If the URL points to a PDF, read it directly with the Read tool
- **`local:` prefix**: Read the local file. Example: `local:jds/linkedin-pm-ai.md` → read `jds/linkedin-pm-ai.md`

## Automatic numbering

1. Run `node reserve-report-num.mjs` to claim the next sequential number (stdout returns `{###}`).
2. Write the report file using that number.
3. Release the sentinel by running `node reserve-report-num.mjs --release {###}` once the report is written.

## Source synchronization

Before processing any URL, verify sync:
```bash
node cv-sync-check.mjs
```
If there is a desynchronization, warn the user before continuing.
