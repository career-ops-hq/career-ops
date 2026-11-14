# Mode: pipeline — URL Inbox (Austria market)

Processes posting URLs accumulated in `data/pipeline.md`. The candidate adds
URLs whenever, then runs the pipeline to process them in one batch.

## Base workflow

Follow `modes/pipeline.md` verbatim. Find pending items with
`grep -n -m 20 '^- \[ \] ' data/pipeline.md` (or the lane file the inbox
resolves to), search again after each batch, and repeat until the search
prints only items you left in Pending this run; never read the whole file.
Then reserve report numbers → extract each JD (Playwright → WebFetch →
WebSearch) → full A-H evaluation via `modes/at/offer.md` → report + tracker →
move to Processed → summary table. The notes below are Austria-specific.

- **Optional — CLI extractor (`scan.extractor: cli` in `config/profile.yml`):**
  run `node browser-extract.mjs <url>` (`--mode jd`) instead — compact
  `{ "url", "title", "text" }`, fewer tokens (portal-dependent). **Fall back
  silently** to Playwright / WebFetch on error or absence.

## Austrian portal notes

- **Employer careers pages and ATS boards** (Personio, Greenhouse, Lever,
  Workday, SmartRecruiters and others): the canonical source. Prefer them over
  any board copy of the same role.
- **karriere.at** and **StepStone (stepstone.at):** the main Austrian job
  boards. Many listings are also on the employer's own page; confirm there.
  Recruiter-mediated listings ("für unseren Kunden", "on behalf of our
  client") go through the agency-confirmation guardrail.
- **AMS ALLE JOBS (jobs.ams.at):** the public employment service's search,
  which also collects postings from other sites. Treat it as an aggregator:
  confirm at the employer before evaluating (AGENTS.md → "Aggregator
  Listings — Confirm at the Employer").
- **LinkedIn, Indeed:** aggregator-style listings; same rule.
- **Jobbörse des Bundes:** federal public-service vacancies. Public-service
  pay follows its own pay rules rather than a private-sector KV; read the
  posting's own pay statement.

## JD extraction quirks

- **Capture the salary statement verbatim.** Austrian postings state a minimum
  pay, often at the end under "Wir bieten", "Gehalt", "What we offer" or
  "Salary". Keep the exact sentence for Block D (`modes/at/_shared.md`).
- **Single-page-app boards and ATS pages:** use Playwright
  (`browser_navigate` + `browser_snapshot`) when WebFetch returns only
  navigation or footer text.
- **Login walls or cookie walls that hide the description:** mark the item
  `- [!]` and ask the candidate to paste the JD text.
- **PDF postings:** read directly with the Read tool, never WebFetch.

## Pipeline format

Same as `modes/pipeline.md`:

```markdown
## Pending
- [ ] https://example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company | Senior Backend Engineer
- [!] https://private.url/job -- Error: login required

## Processed
- [x] #143 | https://example.com/posting/789 | Acme GmbH | Full Stack Engineer | 4.2/5 | PDF yes
```

Section headers stay flexible ("Pending"/"Processed"); keep the existing
style when writing back.
