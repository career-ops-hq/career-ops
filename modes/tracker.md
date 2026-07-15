# Mode: tracker — Applications Tracker

Read and display `data/applications.md`.

**Tracker Format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
```

With the optional Via column (intermediary channel, #1596) after Company:

```markdown
| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
```

- `Via` = the agency/recruiter firm the application goes through; `—` for direct applications. Add the column to an existing tracker with `node merge-tracker.mjs --migrate-via` (all scripts auto-detect both layouts).
- **Unknown end employer** (recruiter hasn't named the client yet): Company = `?` (the structural marker — never the word "Confidential", which is locale-dependent and collides with real firm names), Via = the agency, and a distinguishing descriptor in Notes (e.g. `fintech, Leeds`). Display it to the user as "Confidential (via {Via})".
- The row's identity is its `#` (report number) — Company is display data and changes at most once, at reveal.

Possible states: `Evaluated` → `Applied` → `Responded` → `Interview` → `Offer` / `Rejected` / `Discarded` / `SKIP`

- `Evaluated` = offer evaluated with report, pending decision
- `Applied` = the candidate submitted their application
- `Responded` = Company has responded (not yet interview)
- `Interview` = active interview process
- `Offer` = job offer received
- `Rejected` = rejected by company
- `Discarded` = discarded by candidate or offer closed
- `SKIP` = doesn't fit, don't apply

If the user asks to update a state, edit the corresponding row.

**Salary observations:** when the user reports a confirmed compensation figure for a row ("recruiter said 84k", "offer letter says 92k", "signed at 90k"), append one `actual` observation line to `data/salary-observations.tsv` (create the file if missing; format per `docs/SCRIPTS.md` → salary-gap) with the source tier matching how the figure arrived: `recruiter-verbal` for a spoken figure, `offer-letter` for a written offer, `contract` for a signed contract. The log is append-only — a new figure is a new line, never an edit of a prior one. Then echo that application's gap in one line (advertised vs actual vs desired); `node salary-gap.mjs --summary` shows the full picture.

**Reveal workflow (#1596):** when the user learns the end employer of a `?` row ("the Hays role is Barclays"):

1. Edit the row's Company cell in place (`?` → real name). Never renumber.
2. Update the report: append the company to the H1 title, fill the header fields, and set `company_confidential: false` (+ real `company:`) in the Machine Summary YAML. **Never rename the report file** — the number is the identity, links stay stable.
3. Run the cross-channel check: `node verify-pipeline.mjs`. If the same company+role now exists under a different Via (agency + direct, or two agencies), warn the user loudly — **never auto-merge**; both submissions really happened and the user decides which channel owns the candidacy.

Be honest about timing: this check catches damage after the fact. The preventive check happens in `apply` mode, before authorizing an agency submission.

Also show statistics:
- Total applications
- Breakdown by state
- Average score
- % with PDF generated
- % with report generated
- If `data/salary-observations.tsv` has confirmed `actual` observations, include the output of `node salary-gap.mjs --summary` (advertised→actual gaps, desired attainment)

For the full lifetime stats view (cumulative funnel, scanner totals, portal
coverage, follow-up compliance), run `node stats.mjs --summary` and present its
output. Zero tokens — never recompute these numbers manually.
