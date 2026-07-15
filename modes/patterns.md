# Mode: patterns -- Rejection Pattern Detector

## Purpose

Analyze all tracked applications to find patterns in outcomes and surface actionable insights. Identifies what's working (archetypes, remote policies, score ranges) and what's wasting time (geo-restricted roles, stack mismatches, low-score applications).

When interview sessions are available, it also reads *what the candidate actually says in the room* — a higher-resolution, lower-noise signal of role-fit than win/loss — to detect role **misfit**: when the candidate's strongest, most fluent answers point at a different role-type than the one they keep applying to (Step 1b).

## Inputs

- `data/applications.md` — Application tracker
- `reports/` — Individual evaluation reports
- `config/profile.yml` — User profile (for recommendation context)
- `modes/_profile.md` — User archetypes and framing
- `portals.yml` — Portal config (for filter update recommendations)
- `interview-prep/sessions/*.md` — Interview sessions (optional; drives Step 1b). Drop real-interview transcripts and mock-session files here.

## Minimum Threshold

Before running analysis, check: does `data/applications.md` have at least 5 entries with status beyond "Evaluated" (i.e., Applied, Responded, Interview, Offer, Rejected, Discarded, SKIP)?

If not, tell the user:
> "Not enough data yet -- {N}/5 applications have progressed beyond evaluation. Keep applying and come back when you have more outcomes to analyze."

Exit gracefully.

## Step 1 — Run Analysis Script

Execute:

```bash
node analyze-patterns.mjs
```

Parse the JSON output. It contains:

| Key | Contents |
|-----|----------|
| `metadata` | Total entries, date range, analysis date, counts by outcome |
| `funnel` | Count per status stage (evaluated, applied, interview, offer, etc.) |
| `scoreComparison` | Avg/min/max score per outcome group (positive, negative, self_filtered, pending) |
| `archetypeBreakdown` | Per-archetype: total, positive, negative, self_filtered, conversion rate |
| `blockerAnalysis` | Most frequent hard blockers: geo-restriction, stack-mismatch, seniority, onsite |
| `remotePolicy` | Per-policy bucket: total, positive, negative, conversion rate |
| `companySizeBreakdown` | Per-size bucket: startup, scaleup, enterprise |
| `vendorAnalysis` | ATS channel analysis: per-vendor advance rate + coverage (see below) |
| `viaChannelAnalysis` | Via channel analysis (#1596): per-agency advance rate + agency-vs-direct aggregate (see below) |
| `scoreThreshold` | Recommended minimum score + reasoning |
| `techStackGaps` | Most frequent tech gaps in negative outcomes |
| `recommendations` | Top 5 actionable items with reasoning and impact level |

If the script returns `error`, display the error message and exit.

### `vendorAnalysis` — how to present it (IMPORTANT: causal humility)

`vendorAnalysis` groups **submitted** applications by the ATS vendor detected from
each report's `**URL:**` (community ATS with clean fingerprints only: Greenhouse,
Lever, Ashby, Workday — white-labeled ATS are not URL-detectable and fall into an
unreported `unknown` bucket). `advanceRate` = share that reached
`Responded`/`Interview`/`Offer` (a bare `Applied` does **not** count).

Motivation: *Algorithmic Monocultures in Hiring* (Bommasani et al., FAccT 2026,
[arXiv:2605.27371](https://arxiv.org/abs/2605.27371)) — rejections through a shared
screener are correlated, not independent, so a concentrated dead channel has
diminishing returns.

When you narrate this to the user:
- **Report channel yield, NOT discrimination.** A single tracker cannot separate
  "the vendor's algorithm filters me" from "that vendor skews toward a segment I
  fit poorly." Never claim bias. The honest, useful framing is: *"X% of your
  applications go through {vendor} and it's advancing far less than your other
  channels — route those companies through referral/direct contact instead."*
- Respect `sufficientSample`: if false, mention the vendor only as an observation
  ("too few to conclude"), never as a recommendation.
- Always state coverage (`coveragePct`) so the user knows the stats cover a subset.
- The `recommendations` array already contains the `high`-impact channel action
  when one qualifies — surface it verbatim rather than inventing a stronger claim.

### `viaChannelAnalysis` — per-agency advance rate (#1596)

Groups **submitted** applications by their `Via` channel (the recruiter/agency
firm; requires the optional Via column, #1596 — trackers without it produce
empty buckets and nothing is claimed). `—` rows count as `direct`; the
`breakdown` lists each agency with total/advanced/`advanceRate`/`sufficientSample`.
Submitted rows with an *empty* Via cell (legacy tracker or blank cell, as
opposed to the explicit `—` direct marker) belong to neither bucket and are
counted in `unknownVia` — when it's non-zero, state it so the user knows the
agency/direct split covers a subset of submissions.
In an agency-mediated search the highest-leverage decision is which recruiter
relationships to invest in — this shows which ones actually convert.

Same causal-humility rules as `vendorAnalysis`: report channel yield, never a
causal claim; respect `sufficientSample`; a strong agency is *"prioritize roles
via X — it converts"*, a weak one is an observation, not an accusation.
- The `recommendations` array already contains the `medium`-impact
  best-converting-agency action when one qualifies — surface it verbatim rather
  than inventing a stronger claim.

### Salary lens (optional)

If compensation observations exist (report `advertised_comp` keys or `data/salary-observations.tsv` lines), run `node salary-gap.mjs --summary` as an additional lens: advertised→actual haircut per (company, role) and per currency, plus desired-attainment. Zero tokens — never recompute these numbers manually. Respect its data-quality section the same way as `sufficientSample`: low sample sizes are observations, not recommendations.

## Step 1b — Session-Content Targeting Signal (optional)

Outcome data (Step 1) tells you *whether* you're winning. Interview sessions tell you *what role you're actually selling* in the room — a higher-resolution, lower-noise signal of role-fit than win/loss, which is confounded by comp, timing, headcount, and a dozen reasons unrelated to fit.

**Run this step only if session data exists.** Check: `interview-prep/sessions/*.md` (excluding `README.md` and `.gitkeep`).

If no sessions are present, **skip this step silently** and proceed with outcome-only analysis. This step is purely additive — the mode works fully without it, and gains resolution once sessions accumulate.

If sessions exist, for each one:
1. Separate the candidate's answers from the interviewer's questions. If speaker labels are missing, infer them (turns tagged `**Interviewer:**` / `**Candidate:**` per the session format).
2. Determine the competency / role-signal each substantive answer demonstrates (e.g. *instructional-design*, *systems-architecture*, *data-analysis*, *stakeholder-management*, *people-leadership*). **Tags first, inference as fallback:** if the answer already carries an explicit competency tag — `<!-- competency: ... -->` per the convention in `interview-prep/sessions/README.md`, whether written by hand or emitted by a debrief tool (e.g. `interview/debrief`) — use it directly. Only infer the competency yourself when no tag is present.
3. Mark whether the answer is **fluent and specific** (concrete metrics, named tools, real decisions) or **flat and generic** (hedged, vague, textbook).

Then aggregate across all sessions:
- **Where do the fluent/specific answers cluster?** That competency cluster is the role-type the candidate is *actually* strongest at — regardless of the title on their résumé.
- Compare that cluster against (a) the archetypes in `modes/_profile.md` and (b) the distribution of roles actually applied to in `data/applications.md`.
- **Surface the misfit:** if the strongest cluster (X) is under-represented in the roles applied to (Y), that is a targeting-correction signal:
  > "Your answers consistently light up around **X**, but you're mostly applying to **Y**. Consider adding archetype X and reweighting `portals.yml` `title_filter.positive` toward it."

This is the difference between *"you're losing"* (Step 1, outcomes) and *"you're aiming at the wrong target"* (Step 1b, content). Feed the result into the Step 2 report and Step 4 recommendations.

**Privacy:** sessions contain real interviewer names and companies. Read them locally only; **never quote a real name or company into a committed report.** Summarize the signal (competency clusters), never the content.

## Step 2 — Generate Report

Write the report to `reports/pattern-analysis-{YYYY-MM-DD}.md`.

### Report Structure

```markdown
# Pattern Analysis -- {YYYY-MM-DD}

**Applications analyzed:** {total}
**Date range:** {from} to {to}
**Outcomes:** {positive} positive, {negative} negative, {self_filtered} self-filtered, {pending} pending

---

## Conversion Funnel

Show each status with count and percentage of total. Use a simple table:

| Stage | Count | % |
|-------|-------|---|
| Evaluated | X | X% |
| Applied | X | X% |
| ... | | |

## Score vs Outcome

| Outcome | Avg Score | Min | Max | Count |
|---------|-----------|-----|-----|-------|
| Positive | X.X/5 | X.X | X.X | X |
| Negative | ... | | | |
| Self-filtered | ... | | | |
| Pending | ... | | | |

## Archetype Performance

Table with each archetype, total applications, positive outcomes, conversion rate.
Highlight the best-performing archetype and the worst.

## Top Blockers

Frequency table of recurring hard blockers (geo-restriction, stack-mismatch, etc.).
Note the percentage of all applications affected by each.

## Remote Policy Patterns

Table showing conversion rate by remote policy bucket (global, regional, geo-restricted, hybrid/onsite).

## Tech Stack Gaps

List of most common missing skills in negative/self-filtered outcomes with frequency.

## Recommended Score Threshold

State the data-driven minimum score and reasoning.

## Targeting Signal (interview sessions)

*Include this section only if Step 1b ran.* Summarize, in competency terms only (no real names/companies):
- Which competency cluster the candidate's answers are strongest at (X)
- Which role-types they're actually applying to (Y)
- The misfit gap and the suggested realignment (add archetype X / reweight `portals.yml`)

## Recommendations

Number the top recommendations (from the script output). For each:
1. **[IMPACT]** Action to take
   Reasoning behind the recommendation.
```

## Step 3 — Present Summary

Show the user a condensed version with:
1. One-line stat summary (X applications, Y% applied, Z% positive outcome)
2. Top 3 findings (most impactful patterns)
3. Link to full report

Example:
> **Pattern Analysis Complete** (24 applications, Apr 7-8)
>
> Key findings:
> - Geo-restricted roles are 0% conversion (7 of 24) -- stop evaluating US/Canada-only postings
> - Regional/global remote roles convert at 57-67% -- these are your sweet spot
> - No positive outcomes below 4.2/5 -- consider this your score floor
>
> Full report: `reports/pattern-analysis-2026-04-08.md`

## Step 4 — Offer to Apply Recommendations

Ask the user if they want to act on any recommendations:

> "Want me to apply any of these recommendations? I can:
> - Update `portals.yml` to filter out geo-restricted roles
> - Set a score threshold in `_profile.md` for PDF generation
> - Adjust archetype targeting based on what's converting
> - Realign targeting from the session signal — add the under-targeted archetype X to `modes/_profile.md` and reweight `portals.yml` `title_filter.positive` (if Step 1b ran)
>
> Just say which ones, or 'all' to apply everything."

If the user agrees:
- For portal filter changes: edit `portals.yml`
- For profile/archetype changes: edit `modes/_profile.md` (NEVER `_shared.md`)
- For score threshold: add to `config/profile.yml` under a `patterns` key

## Outcome Classification

For reference, outcomes are classified as:

| Status | Outcome |
|--------|---------|
| Interview, Offer, Responded, Applied | **Positive** (invested effort or got traction) |
| Rejected, Discarded | **Negative** (company said no or offer closed) |
| SKIP, NO APLICAR | **Self-filtered** (user decided not to apply) |
| Evaluated | **Pending** (no action taken yet) |
