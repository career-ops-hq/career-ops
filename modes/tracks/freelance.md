# Track: freelance

Read `tracks.freelance` from `config/profile.yml`: `mode` (`alongside` or
`only`), `day_rate` (target, minimum, currency), `hours_per_day`,
`billable_days_per_year`, `min_contract_months`, `max_payment_terms_days`,
`accept_agencies`, `fx_to_base`.

Apply this file when the engagement is freelance or contract work: the
candidate would invoice as a self-employed person or through their own
company. Fixed-term employment and temp-agency employment are employment:
they follow `modes/tracks/europe.md` and the normal comp analysis.

With "mode: only", a posting that is plainly employment is a blocker. With
"mode: alongside", employment is evaluated as usual and Block D adds one line
comparing the two tracks (below).

## Block D for a gig: rate instead of salary

Replace the salary analysis with a rate analysis. Keep the block title.

| Row | Content |
|-----|---------|
| Rate stated | The posting's figure, verbatim, with unit and currency. "Not stated" if absent. |
| As a day rate | Hourly times `hours_per_day`. State the assumption. |
| Against your target | Above target, meets target, between minimum and target, below minimum, or "no target set". |
| Market | Day-rate benchmarks for this skill and country, each with its source and date. "No benchmark found" beats a borrowed number. |
| Length and volume | Months, days per week, and the contract value they imply: day rate x days. Mark it "~" when any factor is assumed. |
| Extension | Stated, likely (ongoing programme, "long-term", "Option auf Verlängerung"), or not stated. |
| Start | Date or "ASAP". |

Rules:

- Never annualise a day rate by multiplying it by 260. Use
  `billable_days_per_year` and say that it excludes leave, illness and
  acquisition time.
- A rate quoted in another currency is converted only with the user's own
  `fx_to_base` rates. Without one, show the figure unconverted.
- A rate you estimate because the posting gives none is marked "~", is never
  compared against the minimum, and never lowers the score.
- With no target and no minimum configured, the rate is information: show the
  market comparison and do not count pay against the gig.
- Comparing with employment ("mode: alongside"): the day rate that matches a
  salary is roughly salary x 1.3 / `billable_days_per_year` (employer on-costs
  spread over billable days). `track-signals.mjs` reports it as
  `freelanceEquivalent`. Label it a rule of thumb.

Score the Comp dimension from the rate against target and market, not from a
salary scale.

## Client or agency

State who the contract would be with.

- **Direct**: client named, contract with the client.
- **Agency or platform** ("unser Kunde", "our client", a staffing firm, a
  talent marketplace): the end client is usually hidden, the agency keeps a
  margin, and the contract chain decides payment terms and liability. Use the
  existing agency-confirmation gate for the tracker. Ask: who the end client
  is, what the client pays versus what the freelancer gets, whether the agency
  is the paying party, and whether a customer-protection clause restricts
  later direct work.
- If `accept_agencies` is false, an agency posting is a caution, not a
  blocker: the user decides.

## Payment terms

Report the days to payment and the invoicing rhythm when stated. Above
`max_payment_terms_days` is a caution. Not stated is a question: "What are
the payment terms, and who pays: you or the end client?" Flag pay-when-paid
clauses, unpaid trial work, and "equity only" as red flags.

## Scheinselbstaendigkeit (Germany)

Run this when the candidate or the client is in Germany. German pension law
(§ 7 SGB IV) treats a contractor as an employee when they are bound by
instructions and integrated into the client's organisation. The cost of a
wrong classification falls mostly on the client, and clients therefore walk
away from set-ups that look risky.

Indicators to look for in the posting, each quoted verbatim:

- works under the client's instructions on what, when and where
- embedded in the client's team, stand-ups and tools as a team member
- fixed working hours or core hours set by the client
- must work at the client's premises
- uses the client's laptop, accounts or email address
- full-time for one client for a long period (a year or more is a common
  internal limit at German companies)
- leave must be agreed with the client

Mitigating facts: a defined deliverable or work packages ("Werkvertrag",
milestones), free choice of hours and place, own equipment, several clients,
a contract that names a status determination ("Statusfeststellungsverfahren").

Report a risk level with its evidence: **low** (mitigations, no indicators),
**elevated** (one or two indicators), **high** (three or more, or full-time
on site for a year). High is a caution in Red flags and a set of questions for
the client, not an automatic rejection. Say once that this is a reading of the
posting, not a legal assessment, and that only a Statusfeststellung by the
Deutsche Rentenversicherung settles it.

For UK contracts, report whether the posting says inside or outside IR35.
"Inside IR35" means payroll-style deductions: compare the rate accordingly
and say so.

## Other terms to surface

Exclusivity and non-compete clauses, who owns the work results, liability
caps and required insurance, notice period, travel, and whether expenses are
included in the rate. Not stated is a question, never a negative.

## After the evaluation

Offer `pitch` instead of a cover letter: a gig is won with a short proposal,
not a letter. In the report, the section "Cover Letter Draft" becomes
"Pitch Draft" and follows `modes/pitch.md`. Offer `rate` for the negotiation
position.

Record the tracker row with the gig segment described in
`modes/tracks/README.md`.
