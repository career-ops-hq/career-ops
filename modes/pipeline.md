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

## Workflow

1. **Read** `data/pipeline.md` → search for `- [ ]` items in the "Pending" section. Run the **Liveness sweep** (above) first and drop any expired entries before continuing.
2. **For each surviving pending URL**:
   a. Claim the next sequential `REPORT_NUM` atomically by running `node reserve-report-num.mjs` (and release the sentinel using `node reserve-report-num.mjs --release <num>` after the report is written)
   b. **Extract JD** using Playwright (browser_navigate + browser_snapshot) → WebFetch → WebSearch
   c. If the URL is not accessible → mark as `- [!]` with a note and continue
   d. **Execute full auto-pipeline**: Evaluation A-F → Report .md → PDF (if score >= `auto_pdf_score_threshold`) → Tracker
   e. **Move from "Pending" to "Processed"**: `- [x] #NNN | URL | Company | Role | Score/5 | PDF ✅/❌`

   **About the PDF gate (configurable):** Read `config/profile.yml` → `auto_pdf_score_threshold`. If the key does not exist, default to `3.0` (this mode's original gate). If the evaluation score is less than the threshold, skip PDF generation: write the report normally, show in the header `**PDF:** not generated — run /career-ops pdf {company-slug} to create on demand`, and mark PDF ❌ in the tracker. If the score is ≥ threshold, generate the PDF as usual.

   **Tuning it:** Generating a tailored PDF costs ~30–60s per entry (Playwright launch + HTML render) and produces files that often go unused — most roles score in the 2.x/3.x range and never reach the application stage. Raise `auto_pdf_score_threshold` (e.g. `4.0`) to write only the report for marginal offers and produce the PDF on demand via `/career-ops pdf {slug}`; set `0` to generate one for every offer. Both modes (Path A `/career-ops pipeline` and Path B `batch/batch-runner.sh`) read the same key, so behavior is identical regardless of which path processes an offer.
3. **If there are 3+ pending URLs**, launch agents in parallel (Agent tool with `run_in_background`) to maximize speed.
4. **At the end**, show summary table:

```
| # | Company | Role | Score | PDF | Recommended action |
```

## Format of pipeline.md

```markdown
## Pending
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Inc | Senior PM
- [!] https://private.url/job — Error: login required

## Processed
- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | AI PM | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF ❌
```

## Intelligent JD detection from URL

1. **Playwright (preferred):** `browser_navigate` + `browser_snapshot`. Works with all SPAs.
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
