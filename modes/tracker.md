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
- `Notes` is free text with one reserved segment: `posted: YYYY-MM-DD`, when the requisition went live. Write it as its own `;`-separated segment at the end of the note (`fintech, Leeds; posted: 2026-08-07`) and only from a pipeline entry's `| posted:` segment (`modes/pipeline.md`) — never from a guess. The dashboard reads it for the POSTED column (requisition age) and, having read it, excludes it from the last-contact calculation: a req going live is not an interaction with the company. Only a leading segment counts, so ordinary prose that happens to contain "posted" — "recruiter posted an update 2026-07-20" — stays a contact date, which is what it is.

Possible states: `Evaluated` → `Applied` → `Responded` → `Interview` → `Offer` / `Rejected` / `Discarded` / `SKIP`

- `Evaluated` = offer evaluated with report, pending decision
- `Applied` = the candidate submitted their application
- `Responded` = Company has responded (not yet interview)
- `Interview` = active interview process
- `Offer` = job offer received
- `Rejected` = rejected by company
- `Discarded` = discarded by candidate or offer closed
- `SKIP` = doesn't fit, don't apply

If the user asks to update a state, use the canonical CLI — `node set-status.mjs <report#|company> <state>` — rather than hand-editing the row: it validates the state, holds the tracker lock, and appends the transition to `data/status-log.tsv` (the ledger `funnel-velocity.mjs` reads). When the user states the real event date ("they replied on Tuesday", "rejected me last week"), pass `--on YYYY-MM-DD` so the ledger records when it actually happened, not when it was typed in. Hand-edit only what set-status can't express (non-status cells).

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
- If the tracker has Applied-or-beyond rows, include the output of `node funnel-velocity.mjs --summary` (funnel rates vs market benchmarks, in-flight waits, stage velocity once `data/status-log.tsv` has data). Keep its honesty framing intact: the selection-bias note on above-range rates, censored counts next to medians, and no multiplier claims the script itself didn't print

For the full lifetime stats view (cumulative funnel, scanner totals, portal
coverage, follow-up compliance), run `node stats.mjs --summary` and present its
output. Zero tokens — never recompute these numbers manually.

If any company in the tracker shows a `silent-on-you` responsiveness label, also offer `node company-history.mjs --summary` — the per-company evidence cards (hygiene nudge first, then silent-first) give the user the underlying facts before they decide how to prioritize.
