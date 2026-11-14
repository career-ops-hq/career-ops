# Mode: pipeline — URL Inbox (India market)

Processes posting URLs accumulated in `data/pipeline.md`. The candidate adds
URLs whenever, then runs the pipeline to process them in one batch.

## Base workflow

Follow `modes/pipeline.md` verbatim. Find pending items with
`grep -n -m 20 '^- \[ \] ' data/pipeline.md` (or the lane file the inbox
resolves to), search again after each batch, and repeat until the search
prints only items you left in Pending this run; never read the whole file.
Then reserve report numbers → extract each JD (Playwright → WebFetch →
WebSearch) → full A-H evaluation via `modes/in/offer.md` → report + tracker →
move to Processed → summary table. The notes below are India-specific.

- **Optional: CLI extractor (`scan.extractor: cli` in `config/profile.yml`):**
  run `node browser-extract.mjs <url>` (`--mode jd`) instead: compact
  `{ "url", "title", "text" }`, fewer tokens (portal-dependent). **Fall back
  silently** to Playwright / WebFetch on error or absence.

## Indian portal notes

- **Employer careers pages and ATS boards** (Greenhouse, Lever, Ashby,
  Workday, SmartRecruiters, Darwinbox, Keka and others): the canonical source.
  Prefer them over any board copy of the same role.
- **Naukri, Foundit, Instahyre, Cutshort, Wellfound, Internshala:** job boards
  where many listings also sit on the employer's own page; confirm there before
  evaluating (AGENTS.md → "Aggregator Listings -- Confirm at the Employer").
  Listings posted by a consultancy, or that hide the employer, go through the
  agency-confirmation guardrail.
- **LinkedIn, Indeed:** aggregator-style listings; same rule. A LinkedIn page
  that hides the description behind a login is marked `- [!]` so the candidate
  can paste the text.
- **Campus and national hiring portals** of the large IT services firms: the
  posting there is the employer's own, but eligibility rules change by drive.
  Read them from the page; never from memory (`modes/in/_shared.md` rule 7).
- **Government and public-sector jobs** (for example ncs.gov.in, public-sector
  undertakings, recruitment boards): pay follows government pay levels, not a
  CTC. Read the posting's own pay statement and eligibility notice.

## JD extraction quirks

- **Capture the header and the description.** Job boards show an experience
  range and a CTC range in the header that can disagree with the description.
  Keep both lines verbatim for Block B and Block D (`modes/in/_shared.md` rules
  3 and 10).
- **Capture batch, joining and cut-off lines verbatim** ("2026 batch",
  "immediate joiners", "{N}% throughout", "no active backlogs") for Block B.
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
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company | Software Engineer
- [!] https://private.url/job -- Error: login required

## Processed
- [x] #143 | https://example.com/posting/789 | Acme Pvt Ltd | Backend Engineer | 4.2/5 | PDF yes
```

Section headers stay flexible ("Pending"/"Processed"); keep the existing
style when writing back.
