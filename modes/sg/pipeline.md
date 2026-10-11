# Mode: pipeline — URL Inbox (Singapore market)

Processes posting URLs accumulated in `data/pipeline.md`. The candidate adds
URLs whenever, then runs the pipeline to process them in one batch.

## Base workflow

Follow `modes/pipeline.md` verbatim: read `data/pipeline.md` → reserve report
numbers → extract each JD (Playwright → WebFetch → WebSearch) → full A-H
evaluation via `modes/sg/offer.md` → report + tracker → move to Processed →
summary table. The notes below are Singapore-specific.

- **Optional — CLI extractor (`scan.extractor: cli` in `config/profile.yml`):**
  run `node browser-extract.mjs <url>` (`--mode jd`) instead — compact
  `{ "url", "title", "text" }`, fewer tokens (portal-dependent). **Fall back
  silently** to Playwright / WebFetch on error or absence.

## Singapore portal notes

- **MyCareersFuture** (mycareersfuture.gov.sg): the national jobs portal and
  the strongest legitimacy signal for EP-sponsored roles — employers must
  advertise here for 14+ consecutive days before an EP application (Fair
  Consideration Framework). Prefer the employer's direct posting, but
  cross-check the MCF ad for salary-range consistency.
- **JobStreet** (jobstreet.com.sg): the highest-volume local board; many
  listings are recruiter-mediated — treat undisclosed-employer posts as
  agency-mediated per the agency-confirmation guardrail.
- **LinkedIn SG / Indeed SG:** aggregator-style listings; confirm at the
  employer's own careers page / ATS before evaluating (see AGENTS.md
  "Aggregator Listings — Confirm at the Employer").
- **Tech in Asia Jobs:** useful for startup roles; verify funding claims
  before weighting them.

## JD extraction quirks

- **MyCareersFuture:** server-rendered pages, usually readable without
  Playwright; salary ranges are mandatory on ads — capture them verbatim.
- **JobStreet:** cookie banner + occasional login wall on full descriptions;
  if blocked, mark `- [!]` and ask the candidate to paste the JD text.
- **Workday SG instances:** SPA — use Playwright (`browser_navigate` +
  `browser_snapshot`); WebFetch alone returns nav/footer only.
- **PDF postings:** read directly with the Read tool, never WebFetch.

## Pipeline format

Same as `modes/pipeline.md`:

```markdown
## Pending
- [ ] https://example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company | Senior AI Engineer
- [!] https://private.url/job -- Error: login required

## Processed
- [x] #143 | https://example.com/posting/789 | Acme Pte Ltd | AI PM | 4.2/5 | PDF yes
```

Section headers stay flexible ("Pending"/"Processed"); keep the existing
style when writing back.
