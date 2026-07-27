# Mode: gambit — Create-a-Role Power Move

You are running **the gambit**: there is NO job posting. Given a target company
and the candidate's background, you (1) diagnose the role the company sorely
needs but has not posted, then (2) make the case for it — a tailored CV, a cover
letter, and a pitch package aimed at the person who can *create* the role.

This mode INVERTS the normal reactive flow. The keystone is a **synthetic JD**:
once you write the invented role as the posting the company *should* publish, the
rest of the pipeline (CV tailoring, cover letter, A–F report blocks) reuses the
standard machinery.

**Honesty is non-negotiable.** NEVER fabricate a company problem to flatter the
pitch. Every claim in the Company-Need Thesis must cite evidence (news, funding,
product, org signals). The synthetic JD must ALWAYS be labeled as authored by the
candidate, not the company. Same rule as "never invent metrics."

## Step 0 — Load context

`_shared.md` is already injected. Also read:
- `modes/_profile.md` — especially `## Your Target Roles`, `## Your Adaptive
  Framing`, `## Your Natural Level & Company-Stage Calibration`, and
  `## Gambit Playbook`.
- `cv.md` (source of truth) + `article-digest.md` (proof points, if present) +
  `config/profile.yml`.

## Step 0.5 — Disambiguate the company (if the name isn't unique)

Before any research, make sure you are aimed at the right entity. Company names
collide — a recipe app, a blockchain firm, and an HR-tech startup can all be
"Crouton."

- If the user gave a **URL or otherwise unambiguous identifier**, use it directly
  and skip to Step 1.
- If the user gave only a **name**, run ONE quick WebSearch to check whether it
  maps to more than one company.
  - **Unique** → proceed to Step 1.
  - **Ambiguous** → STOP. Present the 2–4 candidate companies, each with a
    one-line fit read against the candidate's archetypes (`_profile.md`), and ask
    which one. Do NOT research or generate anything until the user confirms the
    entity.

A gambit's most expensive wrong turn is researching the wrong company under a
shared name — resolve the entity before spending the research/generation budget.
(This is the CHECKPOINT instinct applied one level earlier than the role thesis.)

## Step 1 — Research the company

Use WebSearch + Playwright (single Playwright agent only — see `_shared.md`):
- WebSearch: funding stage + total raised, headcount, recent news (last 6–12
  months), product direction, leadership team + recent exec hires/departures,
  stated priorities, strategic inflection points.
- Playwright: navigate the careers page; snapshot the open roles.
- **Negative-space analysis:** what they ARE hiring reveals priorities and org
  shape. The gap is what is conspicuously MISSING given their trajectory. (E.g.,
  heavy enterprise-sales hiring + a developer-facing product + zero DevRel
  headcount = a developer-relations gap.)
- Detect **company stage** (per the `_profile.md` calibration) — it determines
  the level you can credibly pitch.

## Step 2 — Diagnose 2–3 candidate role theses

Produce a ranked table:

| # | Invented title | Evidenced company gap (cite source) | Archetype leveraged (`_profile.md`) | Stage-calibrated level | Conviction (1–5) |
|---|---|---|---|---|---|

- **Invented title** — what you would call the role.
- **Evidenced gap** — the specific unmet need with a cited signal. No fabrication.
- **Archetype** — which of the candidate's archetypes makes them the credible
  person to fill it.
- **Level** — apply the `_profile.md` company-stage × title calibration.
- **Conviction (1–5)** — a single numeric score (one decimal allowed) for the
  strength of the bet = evidenced need × CV-to-role fit × decision-maker
  reachability. This is the score that flows to the report header, the Machine
  Summary `score`, and the tracker. (5 = slam-dunk; below ~4.0 → likely HOLD,
  see Step 8.)

Recommend one.

## Step 3 — CHECKPOINT (mandatory)

Present the 2–3 theses to the candidate. STOP and ask which to pursue (or to
refine one). Do NOT generate any documents until they choose. Heavy generation
happens only after the bet is chosen.

## Step 4 — Write the synthetic JD

For the chosen role, write the posting the company *should* publish:
- Title + one-line mission
- "Why now" (the company-need thesis in 2–3 cited sentences)
- 12-month mandate / what success looks like
- Responsibilities (5–8)
- Requirements (mapped to what the candidate actually has)

**Header it clearly:**
`> Synthetic role — drafted by {candidate} as a proposal. {Company} has not posted this role.`

## Step 5 — Generate the CV + cover letter (reuse the engine)

Treat the synthetic JD as the JD and run the standard `modes/pdf.md` flow:
- Extract 15–20 keywords from the synthetic JD.
- Tailor the Professional Summary, competencies, and experience ordering.
  NEVER invent — only reword real experience using the synthetic JD's vocabulary.
- Generate the PDF via `node generate-pdf.mjs`.
- Generate a one-page cover letter (same visual design as the CV, per the
  `_shared.md` ALWAYS rule) that maps the synthetic JD's needs to real proof
  points and opens the create-a-role frame.

## Step 6 — Contact discovery (Founder/Exec — create-a-role)

Find the person who could *create* this role (NOT a recruiter — recruiters fill
posted reqs, they do not invent them):
- The exec who owns the function the role would sit in (founder/CEO at seed–A;
  the relevant VP / C-level at Series B+).
- 1–2 alternates.
Use WebSearch (LinkedIn, company about page, news).

**Founder/Exec (create-a-role) contact type** — the outreach is longer than a
`contacto` LinkedIn request (this is email/DM, not a 300-char connection note):
- **Hook (their reality):** the specific, cited gap you see — framed as
  opportunity, not criticism.
- **Bridge (you):** the one proof point that shows you have built exactly this
  before.
- **Ask (low-friction):** a 20-minute conversation about the gap — NOT "give me a
  job." You are offering a perspective, not asking for a req.

## Step 7 — Pitch package

Produce three artifacts:
1. **Cold email** — ~150–200 words. Subject line + body. Hook → bridge → ask.
   Attach CV + memo.
2. **LinkedIn DM variant** — shorter, same arc, no attachment (link the
   portfolio instead).
3. **One-page forwardable memo** — "The {role}: why now, and why me." Spine =
   synthetic JD + the cited thesis + top 3 proof points + a 90-day plan sketch.
   Written to be forwarded internally by the exec.

## Step 8 — Conviction & Go/No-Go gate (MANDATORY)

Before presenting, evaluate the three legs:
- **(a) Evidenced need** — is the gap real and cited, or invented to flatter?
- **(b) Strong fit** — is the CV-to-role match (Block B) strong (≥ ~4.0/5)?
  This is the CV-match component specifically, distinct from the composite
  Conviction score.
- **(c) Reachable decision-maker** — did you find a specific exec who could
  create the role?

**Recommendation:**
- All three strong → **SEND**: present the package and suggest the best channel.
- Any leg weak → **HOLD / DON'T SEND**: say so plainly and name which leg failed.
  Still hand over the drafts (the candidate decides), but lead with the honest
  recommendation. A weak gambit wastes an exec's attention and burns a warm
  company — the "quality over quantity, respect their time" ethos applies
  *harder* here.

## Step 9 — Save report + tracker

### Report

Save to `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` (sequential number =
max existing + 1). Use this gambit-variant structure.

**Header fields** (one per line, in this order):
- `# Gambit: {Company} — {Proposed Role}`
- `**Date:** {YYYY-MM-DD}`
- `**Mode:** gambit (speculative / create-a-role)`
- `**Role (proposed):** {invented title}`
- `**Archetype:** {selected}`
- `**Conviction:** {X}/5`
- `**URL:** {company / careers URL used for research}`
- `**Legitimacy:** N/A (speculative — no posting to verify)`
- `**PDF:** {path or pending}`

**Body sections** (in this order):
- `## G0) Company-Need Thesis` — the evidenced diagnosis. Gaps ranked. Every
  claim cited.
- `## G1) The Synthetic Role` — open with the synthetic-role disclaimer line
  (`> Synthetic role — drafted by {candidate} as a proposal. {Company} has not
  posted this role.`), then the synthetic JD.
- `## A) Role Summary` — of the synthetic role: archetype, domain, function,
  seniority, stage.
- `## B) Match with CV` — synthetic-JD requirements → exact `cv.md` lines.
- `## C) Level & Strategy` — apply the `_profile.md` company-stage × title
  calibration. Sell senior without lying.
- `## D) Comp & Demand` — market comp for the invented role; note speculative
  comp is especially negotiable.
- `## E) Conviction & Go/No-Go` — the Step 8 gate: the three legs + the send /
  hold recommendation.
- `## F) Interview Plan` — STAR+R stories for the conversation the pitch opens.
- `## Documents` — links to the saved CV (in `output/`), the cover letter, and
  the pitch artifacts. Save the cold email, the LinkedIn DM, and the memo to
  `output/` and link them here; inline them only if short.
- `## Keywords extracted` — the 15–20 ATS keywords pulled from the synthetic JD
  in Step 5 (mirrors the standard report format for ATS optimization).

**Then a `## Machine Summary` section containing exactly this YAML fenced block**
(keep all keys — `legitimacy` carries a sentinel so downstream parsers stay
happy; `mode` and `decision_maker` are additive):

```yaml
num: {NNN}
company: {Company}
role: "{invented title} (gambit)"
score: {X.X}
archetype: {selected}
legitimacy: "N/A (speculative)"
recommend: {send | hold | skip}
stage: {detected stage}
comp_estimate: "{range}"
top_gap: "{the company need being filled}"
mode: gambit
decision_maker: "{name, title}"
```

### Tracker

Write a TSV to `batch/tracker-additions/{num}-{company-slug}.tsv` — one line, 9
tab-separated columns (per `_shared.md` / AGENTS.md TSV Format). Column order is
`num`, `date`, `company`, `role`, `status`, `score`, `pdf`, `report`, `notes`:

```
{num}	{date}	{company}	{invented title} (gambit)	Speculative	{X.X}/5	{✅ or ❌}	[{num}](reports/{num}-{slug}-{date}.md)	{one-line: gap + decision-maker}
```

The `score` column is the numeric Conviction value (`{X.X}/5`, e.g. `4.3/5`) —
never write `High/5` or a word.

`Speculative` is a canonical status (defined in `templates/states.yml`, aliases
`spec` / `gambit`). Use it as-is — do NOT substitute `Evaluated` even though the
shorter states tables in `CLAUDE.md` / `AGENTS.md` may not list it.

Then run `node merge-tracker.mjs`. NEVER edit `applications.md` directly to add a
row.
