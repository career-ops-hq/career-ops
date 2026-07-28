# Mode: interview-prep — Company-Specific Interview Intelligence

When the user asks to prep for an interview at a specific company+role, or when an evaluation scores 4.0+ and the user updates status to `Interview`, run this mode.

## Inputs

1. **Company name** and **role title** (required)
2. **Evaluation report** in `reports/` (if exists) — read for archetype, gaps, matched proof points
3. **Story bank** at `interview-prep/story-bank.md` — read for existing prepared stories
4. **CV** at `cv.md` + `article-digest.md` — read for proof points
5. **Profile** at `config/profile.yml` + `modes/_profile.md` — read for candidate context
6. **Recruiter-side risk map** from the evaluation/PDF/application flow if present — use `modes/heuristics/recruiter-side.md` for the risk categories the interview process must resolve
7. **Coffee chat notes** for this company, if the user has any (optional — see "Coffee Chat Cross-Reference" below)
8. **Prior stated compensation** — if the tracker# is known, run `node salary-gap.mjs --stated-for <tracker#>` (zero tokens). Any prior `stated` observation is a number already committed to a specific interviewer in an earlier round — surface it in the Process Overview (Step 2) or Recruiter/HR pack (Step 4) as a "already discussed" reminder so the candidate stays consistent.

## Coffee Chat Cross-Reference (optional, North America-specific)

Before generating prep for a company, check whether the user has a coffee chat note for that company — an off-the-record informational-interview conversation with someone already inside the target company. This is common North American (especially US/CA) job-search practice, grounded in university-career-services norms; other regions may have different or no equivalent informal-networking practice. **This step is additive/opt-in — "if a coffee chat note exists for this company, use it" — never a required step, and never implies every candidate should have coffee chat notes.** If none exists, or the user doesn't do coffee chats, skip this section silently and move on to Step 1.

**How to get it:** the same pasted-in input pattern the Panel Intel table below already relies on (Step 4, `panel-mixed`) — the user references or pastes the note inline. This mode does not scan the filesystem or any external location for it.

If a coffee chat note exists for this company, cross-reference it against:

- **What's known/expected about the interview itself** — the JD, named interviewers (Step 1 research, Panel Intel table in Step 4), and the Step 2 Process Overview.
- **Any existing interview transcript for the same company** — prior rounds already captured in `interview-prep/{company-slug}-{role-slug}.md`, and structured session records in `interview-prep/sessions/` (written by `modes/interview/debrief.md` Step 9).

Surface explicitly whether the coffee chat **corroborates** or **contradicts** something known or suspected about the interview process:

```markdown
## Coffee Chat Cross-Reference
| Coffee chat signal | Cross-referenced against | Read |
|---------------------|---------------------------|------|
| {what the contact said} | {JD line / named interviewer / prior transcript} | Corroborates — {why, e.g. "confirms this is a consistent screening focus, not a one-off tangent"} / Contradicts — {why} |
```

- **One coffee chat is one data point, not proof.** Use corroborating language ("this is consistent with…", "this lines up with…"), never "confirmed" or "fact" language — unless a second independent source (a second coffee chat, or a matching pattern already recorded across two transcripts) exists for the same claim.
- **Contradictions matter as much as corroborations.** If the coffee chat conflicts with the JD or a prior transcript, say so plainly and flag it for the candidate to probe — don't silently trust either source over the other.

## URL entry — prep for a role that was never evaluated

The inputs above are report-first, but a common path skips evaluation entirely: a referral, a recruiter reaching out directly, or an interview booked for a posting that never ran through the pipeline. When there is no report, ingest the JD from the URL instead.

**Trigger — both conditions required:**

1. The user **explicitly asks to prep** and provides a JD URL (e.g. "prep me for this", "interview prep: <URL>", `/career-ops interview-prep <URL>`). A pasted URL alone is NOT enough — per AGENTS.md, a bare URL routes to `auto-pipeline`, not here.
2. **No matching report exists** in `reports/` for that company+role. If a report DOES exist, ignore the URL fetch and use the report — the report stays authoritative.

**Fetch ladder** — same as `modes/oferta.md` and the AGENTS.md Offer Verification rule; JD fetching follows the same ladder:

1. For ATS-shaped URLs (Greenhouse / Lever / Ashby / Workday — the four `liveness-core.mjs` already recognizes), the structured API endpoint may serve the JD directly.
2. Otherwise Playwright: `browser_navigate` → `browser_snapshot`, read title, URL, and visible content.
3. WebFetch **only** as the headless/batch fallback. If the JD came from WebFetch, mark the prep output header `**JD source:** unconfirmed (fetched without browser)`.
4. Closed/expired posting (footer/navbar only, "no longer accepting applications", 404) → tell the user and ask them to paste the JD text instead. **Never fabricate JD content.**

**From the fetched JD, extract:** role title, seniority, key requirements, named team/stack. Feed the normal Step 1+ research flow with these instead of report-derived archetype/gaps — everything downstream is unchanged. Questions derived from the fetched JD keep the `[inferred from JD]` tag.

**What this path does NOT do:**

| Out of scope | Belongs to |
|--------------|------------|
| Tracker writes — prep from URL is read-only on the pipeline | normal apply flow owns the tracker |
| CV generation | `pdf` mode |
| Contact automation | `contacto` |

## Step 1 — Research

Run these WebSearch queries. Extract structured data, not summaries. Cite sources for every claim.

The first round of most processes is a recruiter / HR screen, not a technical panel — so research has to cover both. Group queries by the audience they inform:

**Recruiter / HR screen** (early-round fit, comp, logistics):

| Query | What to extract |
|-------|-----------------|
| `"{company} {role} salary" site:levels.fyi` and `"{company} {role} salary" site:glassdoor.com/Salary` (run both — `OR` inside a quoted phrase is taken literally by most engines) | Comp ranges (base / equity / bonus) by level |
| `"{company} interview process site:glassdoor.com"` then manually filter retrieved reviews to those describing the recruiter / HR screen | Process timeline, screening criteria, common screening questions, recruiter behavior |
| `"{company} site:teamblind.com" comp negotiation OR offer` | Candid comp/leverage details, what recruiters push back on |
| `"{company} careers"` + `"{company} benefits"` | Official comp/benefits framing, work-auth/visa policy, location policy |

**Hiring manager / leadership** (motivation, scope alignment, team fit):

| Query | What to extract |
|-------|-----------------|
| `"{company} engineering blog"` and `"{company} {team} blog"` | Team's recent work, technical priorities, named challenges |
| `"{company}" news OR launch OR roadmap` (last 12 months) | Recent milestones, public bets, hiring drivers |
| `"{company} {role} interview process"` (general) | Hiring-manager round structure, what they evaluate, candidate write-ups |

**Peer / technical panel** (depth, collaboration, on-the-job realism):

| Query | What to extract |
|-------|-----------------|
| `"{company} {role} interview questions site:glassdoor.com"` | Actual questions asked, difficulty rating, experience rating, number of rounds, offer/reject ratio |
| `"{company} {role} interview site:leetcode.com/discuss"` | Specific coding/technical problems, system design topics, round structure |
| `"{company} interview process site:teamblind.com"` then manually filter retrieved threads to those describing technical rounds | Hiring bar, recent technical interview data points |

If the company is small or obscure and yields few results, broaden: search for the role archetype at similar-stage companies, and note that intel is sparse. Do the recruiter-screen queries even when intel is sparse — comp/logistics data exists for almost every company.

**Do NOT fabricate questions.** If a source says "they asked about distributed systems," report that. Do not invent a specific distributed systems question. When generating likely questions from JD analysis, label them clearly as `[inferred from JD]` not sourced from candidates.

**Tag conventions** (don't mix them):

- `[inferred from JD]` — questions derived from the job description rather than a candidate report.
- `[inferred]` — audience classifications (Step 2.5) made from round duration / position when `Conducted by` is unknown.

## Step 2 — Process Overview

```markdown
## Process Overview
- **Rounds:** {N} rounds, ~{X} days end-to-end
- **Format:** {e.g., recruiter screen → technical phone → take-home → onsite (4 rounds) → hiring manager}
- **Difficulty:** {X}/5 (Glassdoor avg, N reviews)
- **Positive experience rate:** {X}%
- **Known quirks:** {e.g., "pair programming instead of whiteboard", "no LeetCode, all practical", "take-home is 4 hours"}
- **Sources:** {links}
```

If data is insufficient for any field, write "unknown — not enough data" rather than guessing.

## Step 2.5 — Audience Map

Classify each round from Step 2 into exactly one audience. The audience drives what gets prioritized in Steps 4 and 7.

| Audience            | Typical round                                | Primary evaluation                                              |
|---------------------|----------------------------------------------|-----------------------------------------------------------------|
| `recruiter-screen`  | First call (15–30 min, recruiter / HR / TA)  | Fit gate: motivation, comp, location/visa, timeline             |
| `hiring-manager`    | Manager / skip-level (30–45 min)             | Why this role, scope alignment, leadership signals              |
| `peer-tech`         | IC technical (live coding, system design, take-home review) | Depth + collaboration on the actual stack                       |
| `panel-mixed`       | Onsite / loop with multiple interviewer types in one block  | Cross-cuts the above                                            |

If `Conducted by` is unknown for a round, infer cautiously from duration, position, and any signals from the JD or job posting. Common patterns:

- Round 1, short (15–30 min) → almost always `recruiter-screen`.
- Round 2 — **do not default**. Many companies put a peer-led technical phone screen here, others put the hiring manager. Prefer `peer-tech` if the round is described as "technical screen" or has a coding/system-design component; prefer `hiring-manager` if it's described as a manager / skip-level / leadership conversation; otherwise mark as `panel-mixed [inferred]` and prep both packs.
- Deep technical block (live coding, system design, take-home review) → `peer-tech`.
- Onsite / loop with multiple back-to-back rounds → `panel-mixed`.

Mark inferred audiences with `[inferred]` and keep going — sparse intel is normal early in research.

```markdown
## Audience Map
- **Round 1** (recruiter screen, 30 min) → `recruiter-screen`
- **Round 2** (technical phone screen, 60 min) → `peer-tech`
- **Round 3** (hiring manager call, 45 min) → `hiring-manager`
- **Round 4** (onsite loop, 4× 45 min) → `panel-mixed`
- ...
```

The example above shows a typical pattern but is not a default. Classify each round from the actual research above — round 2 in particular is often `peer-tech`, not `hiring-manager`.

## Step 3 — Round-by-Round Breakdown

For each round discovered in research:

```markdown
### Round {N}: {Type} — audience: `{audience}`
- **Duration:** {X} min
- **Conducted by:** {peer / manager / skip-level / recruiter — if known}
- **What they evaluate:** {specific skills or traits}
- **Reported questions:**
  - {question} — [source: Glassdoor (URL/date)]
  - {question} — [source: Blind (URL/date)]
- **How to prepare:** {1-2 concrete actions, audience-appropriate — see Step 4 for the full per-audience pack}
```

If round structure is unknown, state that and provide the best available intel on what types of rounds to expect based on company size, stage, and role level.

## Step 4 — Likely Questions (per audience)

Group all discovered and inferred questions by the audience that asks them, not by question type. Within each audience, draft candidate-specific answers using `cv.md`, `article-digest.md`, `config/profile.yml`, and `modes/_profile.md`. **Never fabricate questions** — sourced questions must cite, inferred questions must be tagged `[inferred from JD]`.

If any of those profile files are missing, incomplete, or out-of-date, note the gap inline (e.g. "comp target unknown — defer to recruiter band") and proceed with what's available rather than blocking the prep. The mode's value is partial-but-honest output, not perfect-or-nothing.

For every answer, use result-first framing:

1. **Headline** — the result, decision, or point.
2. **Effect** — why it mattered to the business, users, system, or team.
3. **Rationale** — what tradeoff or constraint shaped the choice.
4. **Operations** — what the candidate actually did, with enough implementation detail to be credible.

This is especially important for senior, technical, and leadership answers. Simple recruiter answers can be shorter, but should still start with the point.

### Audience: `recruiter-screen`

The recruiter is screening for fit, not testing skill. Wrong-foot answers (vague comp, fuzzy motivation, missing logistics) end the process before any technical signal is collected. Cover at minimum:

- **"Walk me through your CV / why are you looking?"** — 60–90s narrative anchored to `modes/_profile.md` narrative + the role's archetype.
- **Comp expectation** — concrete range pulled from Step 1 Levels.fyi/Glassdoor data, anchored to `config/profile.yml` `compensation.target`. Note the leverage hand: if comp data is thin or the candidate has no competing offer, recommend deferring with a clean script ("I'm calibrating to market for {level}, can you share the band for this role?").
- **Why this company** — 2–3 sentences referencing public signals from Step 1 (recent launch, named values, team work). Avoid generic praise.
- **Location / remote / visa** — answer derived from `config/profile.yml` location policy and the role's posted policy. Flag deal-breakers from `modes/_profile.md` so the recruiter can route correctly.
- **Timeline / availability / notice period** — numbers, not vibes.
- **Other processes in flight** — recommended framing only; never push the candidate to lie.
- **Background red flags** — gaps, transitions, unusual elements from `cv.md` + `_profile.md`. Honest, specific, forward-looking framing — never defensive.

### Audience: `hiring-manager`

The HM is screening for motivation + scope fit. They've already trusted the recruiter's logistics gate; they care whether you'd own the work. Cover at minimum:

- **"Why this role, why now?"** — connect candidate's last 1–2 roles + `_profile.md` narrative to the team's named challenge from Step 1.
- **"What would your first 90 days look like here?"** — derived from JD scope + the team's recent work (engineering blog, public roadmap).
- **Risk map closure** — make sure the strongest likely doubts from the evaluation are answered with concrete proof, not enthusiasm.
- **Leadership / collaboration questions** — map to `interview-prep/story-bank.md`.
- **Sharp questions to ask back** — 2–3 tied to a specific recent thing the team shipped or wrote about, not generic "what's the team like".

### Audience: `peer-tech`

This is where the original Technical / Role-Specific buckets live. Peers are evaluating depth and collaboration on the actual stack.

- **Technical questions** (system design, coding, architecture, domain) — for each: the question, source, and what a strong answer looks like for this candidate specifically (reference CV proof points).
- **Role-specific questions** tied to the JD archetype — for each: the question, why they're likely asking it (which JD requirement it maps to), and the candidate's best angle.
- **Reverse questions** — about on-call, code review culture, deployment cadence, what surprised them when they joined.

### Audience: `panel-mixed`

Onsite loops and mixed panels rarely give the candidate time to context-switch — preparation has to be pre-routed.

**Panel Intel table (required whenever panelists are named).** Before drafting per-slot prep, build this table from whatever profile text or screenshot description the user provides — no scraping or automation, the same pasted-in input the mode already relies on elsewhere:

```markdown
## Panel Intel
| Name | Role | Read |
|------|------|------|
| {Panelist A} | {title, tenure, reporting line if visible} | {what their background implies about what they'll ask, and how much weight their questions carry} |
| {Panelist B} | {title, tenure, reporting line if visible} | {...} |
```

Fill the table using these heuristics:

- **Decision-maker weighting**: cross-reference the JD's reporting line (e.g. "reports to Manager: X") against the named panelists. Whoever it points to is the likely primary decision-maker for this loop — flag them explicitly in the `Read` column (e.g. "likely hiring-manager-equivalent — this is who the offer decision routes through") and weight prep effort toward their pack accordingly.
- **Career-trajectory signal**: read the provided experience text or screenshot description for what each panelist's path implies about the kind of questions they'll ask. Someone who held the *exact role being hired for* for several years before being promoted into managing it will ask sharper, more concrete, scenario-based questions than someone in an adjacent function (e.g., HR/recruiting) who is more likely there for process, culture, or compliance framing rather than technical depth. Note this angle in the `Read` column, not just the job title.
- **Audience tagging**: after profiling, still tag each panelist to one of the three existing audiences (recruiter / HM / peer-tech) and pull from that audience's pack — the table doesn't replace that step, it gives it a defined input.

**Per-panelist closing question.** Where a panelist's own trajectory offers an obvious angle, draft one tailored closing question for them specifically — the same pattern this mode already uses at the company level ("Sharp questions to ask back" in the `hiring-manager` and mixed-panel packs, tied to a named team challenge from Step 1), just aimed at the individual instead of the company. For example, someone promoted from the role into managing it is a natural fit for "what do you wish you'd known walking into this role that isn't in the job posting" — a question a recruiter or an adjacent-function panelist couldn't answer as meaningfully. List these alongside the audience pack's own "sharp questions to ask back," tagged with the panelist's name so the candidate knows which slot to use them in.

For each panel slot:

- **If the interviewer is named in the schedule**, use the Panel Intel table above to tag them to one of the three audiences (recruiter / HM / peer-tech). Then pull from that audience's pack.
- **If the slot is unlabeled**, prep all three packs but cap each to 3–5 highest-priority items so the candidate isn't drowning in notes.
- **Hand-off discipline**: tell the candidate explicitly what NOT to repeat verbatim across slots (e.g. the same proof point told identically twice signals scripted answers; vary the angle).
- **Energy management**: 4-hour onsites burn out less-experienced candidates first. Flag the slot most likely to test depth (usually peer-tech) and reserve the candidate's freshest material for it.

## Step 5 — Story Bank Mapping

Run this mapping **per audience pack** from Step 4 — same story can map differently to a recruiter prompt vs a peer-tech behavioral question, and a single un-segmented table risks cross-audience drift.

| # | Audience | Likely question/topic | Best story from story-bank.md | Fit | Gap? |
|---|----------|----------------------|-------------------------------|-----|------|
| 1 | recruiter-screen | ... | [Story Title] | strong/partial/none | |
| 2 | hiring-manager | ... | [Story Title] | strong/partial/none | |
| 3 | peer-tech | ... | [Story Title] | strong/partial/none | |

- **strong**: story directly answers the question
- **partial**: story is adjacent, needs reframing
- **none**: no existing story — flag for the user

For each gap, suggest: "You need a story about {topic}. Consider: {specific experience from cv.md that could become a STAR+R story}."

If the user wants to draft missing stories, help them build STAR+R format and append to `interview-prep/story-bank.md`.

## Step 6 — Technical Prep Checklist

Based on what the company actually tests, not generic advice:

```markdown
- [ ] {topic} — why: "{evidence from research}"
- [ ] {topic} — why: "{their blog/product suggests this matters}"
- [ ] {topic} — why: "{asked in N/M recent Glassdoor reviews}"
```

Prioritize by frequency and relevance to the role. Max 10 items.

## Step 7 — Company Signals (per audience)

Things to say, do, and avoid — segmented by who's listening. The same fact can be a strength to a peer engineer and a yellow flag to a recruiter; framing matters.

### To the recruiter / HR screen

- **What to volunteer**: motivation, location/visa fit, timeline, why this company.
- **What NOT to volunteer**: hard comp number when leverage is uncertain (defer to band); ongoing process details; opinions on the company's recent layoffs / press.
- **Vocabulary**: official company language for benefits and policies (from careers page).
- **Red flags they screen for**: visa surprises, comp mismatch, "looking everywhere" energy.

### To the hiring manager

- **What to lead with**: connection between candidate narrative (`_profile.md`) and a named team challenge from Step 1.
- **Vocabulary to use**: terms the company uses internally — shows homework (e.g., Stripe says "increase the GDP of the internet", Anthropic says "safety" not "alignment").
- **Sharp questions to ask back**: 2–3 tied to recent news / blog posts from Step 1.

### To the peer / technical panel

- **What to lead with**: stack-relevant proof points from `cv.md` / `article-digest.md`.
- **Things to avoid**: anti-patterns flagged in Glassdoor / Blind reviews specific to this company.
- **Reverse questions**: on-call rotation, code review norms, deployment cadence, what surprised them when they joined.

### To a mixed panel

- **What to lead with**: a single 2-sentence framing that lands for all three audiences — usually narrative + named team challenge — then let each interviewer steer.
- **What NOT to repeat**: same proof point told identically across slots; instead, vary the angle (recruiter hears the headline number, HM hears the team-impact framing, peer-tech hears the technical detail).
- **Vocabulary**: keep recruiter-friendly language (impact, scope) when leadership is in the room; switch to peer-language (architecture, trade-offs, on-call) when only ICs are.
- **What to avoid**: contradicting yourself across slots about comp, timeline, or what excites you. Interviewers compare notes.

## Output

Save the full report to `interview-prep/{company-slug}-{role-slug}.md` with this header:

```markdown
# Interview Intel: {Company} — {Role}

**URL:** {job posting URL or company careers URL, or "N/A" if recruiter-sourced}
**Legitimacy:** {tier copied from the evaluation report's Block G, or "unknown" if no report exists}
**Report:** {link to evaluation report if exists, or "N/A"}
**Researched:** {YYYY-MM-DD}
**Sources:** {N} Glassdoor reviews, {N} Blind posts, {N} other
**Audiences covered:** {recruiter-screen, hiring-manager, peer-tech, panel-mixed}
```

## Post-Research

After delivering the report:

1. Ask the user if they want to draft stories for any gaps found in Step 5
2. If they have a scheduled interview date, note it: "Your interview is in {X} days. Want me to set a reminder to review this prep?"
3. Suggest running `deep` mode if the company research in Step 1 was thin — deep mode covers strategy, culture, and competitive landscape in more depth

## Rules

- **NEVER invent interview questions and attribute them to sources.** Inferred questions must be labeled `[inferred from JD]`.
- **NEVER fabricate Glassdoor ratings or statistics.** If the data isn't there, say so.
- **Cite everything.** Every question, every stat, every claim gets a source or an `[inferred]` tag.
- Generate in the language of the JD (EN default).
- Be direct. This is a working prep document, not a pep talk.
