# Mode: triage — First-Pass Quick Score

Rapid first-pass evaluation of a single job URL or JD text. Returns a score and
go/no-go verdict. Writes NO files — no report, no TSV, no cover letter, no STAR
stories. This is a filter gate; roles that pass go to full A-G evaluation.

Used by `modes/pipeline.md` (two-pass mode) to keep expensive full evaluations
for roles that actually clear the bar. Reading the full evaluation context
(`cv.md` + `_shared.md` + `_profile.md` + `profile.yml` + `oferta.md`) costs
tens of thousands of tokens; triage reads one compact file instead.

## Context

Read ONLY `modes/_brief.md`. Do NOT read:
- cv.md
- config/profile.yml
- modes/_shared.md
- modes/_profile.md
- modes/oferta.md

This is the entire point of triage mode. Full context is expensive and not needed
to score a role for go/no-go. Read `_brief.md` once, then evaluate.

`modes/_brief.md` is a user-layer file created from `modes/_brief.template.md`
(auto-copied by `doctor.mjs` on first run). If it does not exist or has not been
filled in, triage cannot run — fall back to full evaluation.

## Steps

### 1. Fetch JD

Get the JD content, mirroring `pipeline.md`'s JD detection so an accessible posting
isn't wrongly skipped just because WebFetch can't read it:

- **PDF URL** (path ends in `.pdf`, or the page serves a PDF): read it directly with
  the **Read** tool. Do NOT WebFetch — WebFetch can't extract PDF text, which would
  wrongly mark a live PDF posting `SKIP`.
- **`local:` prefix** (e.g. `local:jds/role.md`): read the local file with the Read tool.
- **Otherwise:** WebFetch the URL.

If the fetch returns no JD content (error, redirect to a generic careers page, or
only nav/footer), return immediately:

```text
TRIAGE: SKIP | {Company} | {Role or "Unknown"} | 0/5 | Posting inaccessible or expired
```

### 2. Hard DQ check (takes 30 seconds)
Scan JD text for the Hard DQ Criteria listed in `_brief.md`. If any hit, you
already know the score is ≤ 2.5. Note the DQ reason and skip step 3.

### 3. Quick score
Assess five dimensions. 1–2 sentences per dimension — no prose, no headers.
(Weights below are defaults; if `_brief.md` defines its own dimension weights,
use those.)

**Archetype fit (weight 30%):** Does this map to one of the target archetypes in
`_brief.md`? Score 1–5. A direct archetype hit = 4–5. Adjacent = 3. Mismatch = 1–2.

**Comp (weight 25%):** Does stated or estimated comp clear the comp strategy
threshold in `_brief.md`? Use the published range if available; otherwise estimate
from title/company/location. Score 1–5.

**Location (weight 25%):** Score per the Location Scoring rules in `_brief.md`.
Flag high-travel or relocation risk explicitly.

**CV match estimate (weight 15%):** Do the proof points in `_brief.md` map
directly to JD requirements? Strong overlap = 4–5. Partial = 3. No match = 1–2.

**Red flags (adjustment):** Apply the Soft Red Flags from `_brief.md` at −0.5 each.
Hard DQs override to ≤2.5.

**Global score** = (archetype × 0.30) + (comp × 0.25) + (location × 0.25) +
(cv_match × 0.15) + red_flag_adjustment. Round to nearest 0.5.

### 4. Verdict
| Score | Verdict |
|-------|---------|
| ≥ triage_threshold | **PASS** — proceed to full A-G evaluation |
| 3.0–(threshold − 0.1) | **MARGINAL** — one-liner shown to user; skip full eval unless user overrides |
| < 3.0 | **FAIL** — silently filtered; write minimal SKIP TSV only |
| N/A | **SKIP** — inaccessible posting |

(`triage_threshold` is `config/profile.yml → pipeline.triage_threshold`, default `3.5`.)

**Priority override:** If the company is on the Priority Override List in
`modes/_brief.md`, return PASS regardless of score. Check the company name before
returning a verdict.

### 5. Return
Return ONLY this single line. No prose. No markdown. No headers.

```text
TRIAGE: {PASS|MARGINAL|FAIL|SKIP} | {Company} | {Role} | {Score}/5 | {reason ≤ 25 words}
```

**Examples:**
```text
TRIAGE: PASS | Acme Corp | Senior Program Manager | 4.3/5 | Remote, comp clears floor, archetype direct match, 3+ proof points map
TRIAGE: FAIL | Globex | Staff Engineer | 2.0/5 | Hard DQ: primary hands-on coding required — outside target archetypes
TRIAGE: MARGINAL | Initech | Sr PM | 3.4/5 | Required cert is a gap, travel risk, comp barely clears floor
TRIAGE: SKIP | Umbrella | Program Manager | 0/5 | Posting redirected to generic careers page — expired
```

## Rules
- Max 500 tokens of output total
- Return the TRIAGE line as the very last line of your response
- Do not write any files (no reports/, no batch/tracker-additions/)
- Do not generate cover letters, STAR stories, or application answers
- If you are uncertain whether a DQ applies, score conservatively and note it
- Triage produces INTERNAL assessments only — no employer-facing content
