# Mode: tracker — Applications Tracker

Read and display `data/applications.md`.

**Tracker Format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
```

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

Also show statistics:
- Total applications
- Breakdown by state
- Average score
- % with PDF generated
- % with report generated

For the full lifetime stats view (cumulative funnel, scanner totals, portal
coverage, follow-up compliance), run `node stats.mjs --summary` and present its
output. Zero tokens — never recompute these numbers manually.
