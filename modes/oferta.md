# Mode: job — Full A-G Evaluation

When the candidate pastes a job (text or URL), ALWAYS deliver the 7 blocks (A-F evaluation + G legitimacy):

## Liveness gate (URL inputs)

When the candidate pastes a **URL** (not JD text), confirm the posting is still live before doing any evaluation. A dead link must never reach Block A — a 404/expired page wastes a full A-G evaluation, report, and PDF on phantom content.

1. Get the page content: if you arrived here from `auto-pipeline` (its Step 0.5 already navigated and cleared the link), reuse that snapshot — do not navigate again. On a direct URL entry, navigate with Playwright (`browser_navigate` + `browser_snapshot`) and read the title, URL, and visible content. **Opt-in:** if `scan.extractor: cli` is set in `config/profile.yml`, run `node browser-extract.mjs <url>` (default `--mode jd`) instead and use its compact `{ "url", "title", "text" }` (the distilled JD main text rather than the full page a11y tree — fewer tokens for the model, board-dependent), **falling back silently** to `browser_navigate` + `browser_snapshot` if it errors or is missing.
2. Classify the posting:
   - **active posting evidence:** title/role + a real job description or an application/apply path
   - **closed posting evidence:** expired/closed/"no longer accepting applications", missing JD with only nav/footer, hard redirect to a generic careers/search page, or 404/410
3. If the posting appears closed, **stop before Block A**: tell the candidate the link is dead, and if the entry came from `data/pipeline.md`, mark it `- [x] ~~Company | Role~~ — oferta nieaktywna`. Do not generate an evaluation, report, or CV.
4. If the candidate pasted JD text (no URL), liveness cannot be verified — note that and proceed; there is no link to check.

Do not continue to Block A until this gate is resolved. The snapshot captured here is reused by Block G's freshness signals.

## Blacklist gate (#1742)

If `data/blacklist.md` exists, check the posting's company against it before Block A. The file is the candidate's own do-not-apply list (user layer, opt-in): absent file = no gate, and nothing ever adds a company to it automatically. Match case- and punctuation-insensitively — "Acme Corp." on the list catches a JD that says "acme corp".

1. On a hit, **stop before Block A** and surface the candidate's own recorded decision:
   > "{Company} is on your blacklist (since {Since}): *{Reason}*. Do you still want me to evaluate this posting?"
2. Wait for an explicit answer — never silently refuse, never silently proceed. The candidate's call always wins (same HITL spirit as the score < 4.0 rule): an explicit yes runs the full A-G evaluation as normal (note the override in the report notes); anything else stops here with no evaluation, report, or CV.
3. No match, or no `data/blacklist.md` → proceed. A blacklist entry never changes any score anywhere — it is a gate, not a signal.

## Bounded Research Budget

Company, compensation, and hiring-signal research must be a single-pass lookup, not an open-ended investigation. This mode is an evaluation workflow, not deep company research.

Hard limits for Blocks D and G combined:
- hard cap: 5 total WebSearch queries
- Prefer targeted queries that answer more than one question; stop early when enough evidence exists.
- Do not invoke `deep-research`, `deep`, or any other research skill.
- Do not spawn subagents or delegate research to another agent.
- Do not continue researching after the query cap is reached; summarize the evidence found and explicitly mark missing data as unavailable.

If deeper company research is useful, recommend running `/career-ops deep` separately after the evaluation.

## Step 0 — Archetype Detection

Classify the job into one of the 6 archetypes (see `_shared.md`). If it is a hybrid, indicate the 2 closest ones. This determines:
- Which proof points to prioritize in block B
- How to rewrite the summary in block E
- Which STAR stories to prepare in block F

## Block A — Role Summary

Table with:
- Archetype detected
- Domain (platform/agentic/LLMOps/ML/enterprise)
- Function (build/consult/manage/deploy)
- Seniority
- Remote (full/hybrid/onsite)
- Team size (if mentioned)
- **Culture screen** (see `_shared.md` § Scoring System): pass / caution / fail, with the specific evidence found or missing — not just a score, name what you saw
- TL;DR in 1 sentence

### Geo-mismatch check

After filling the Remote row, cross-check the posting's **structured location field** (the location/remote designation shown on the posting page or in ATS metadata — not the Remote row you just wrote) against the JD body:

- **Contradiction** = the location field says remote, but the JD body states a **binding attendance requirement**: "hybrid", "X days per week/month" in office, "in-office", "onsite"/"on-site", mandatory office attendance, or a relocation requirement.
- **Not a contradiction:** negations ("no onsite requirement"), optional or occasional in-person events ("quarterly offsites", "optional co-working space"), or generic benefits boilerplate.
- If the JD body says nothing about location or attendance, emit no flag — silence is absence of signal, not agreement.
- If the input has no structured location field (pasted JD text only), skip this check.

On contradiction, add exactly one flag line at the top of Block B in the report, quoting the evidence **verbatim** (never paraphrase):

`⚠️ **Geo-mismatch:** location field says remote, but JD body says "{verbatim JD line}"`

The flag is an additive line only — Block B's existing content stays unchanged below it, and no flag line appears when there is no contradiction.

## Block B — Match with CV

Read `cv.md`. Create a table with each JD requirement mapped to exact lines in the CV.

**Adapted to the archetype:**
- If FDE → prioritize delivery speed and client-facing proof points
- If SA → prioritize system design and integrations
- If PM → prioritize product discovery and metrics
- If LLMOps → prioritize evals, observability, pipelines
- If Agentic → prioritize multi-agent, HITL, orchestration
- If Transformation → prioritize change management, adoption, scaling

**Gaps** section with mitigation strategy for each. For each gap:
1. Is it a hard blocker or a nice-to-have?
2. Can the candidate demonstrate adjacent experience?
3. Is there a portfolio project that covers this gap?
4. Concrete mitigation plan (phrase for cover letter, quick project, etc.)

## Block C — Level and Strategy

1. **Level detected** in the JD vs **candidate's natural level for that archetype**
2. **"Sell senior without lying" plan**: specific phrases adapted to the archetype, concrete achievements to highlight, how to position founder experience as an advantage
3. **"If they downlevel me" plan**: accept if compensation is fair, negotiate 6-month review, clear promotion criteria

## Block D — Comp and Demand

Use the bounded research budget above for:
- Current salaries for the role (Glassdoor, Levels.fyi, Blind)
- Company's compensation reputation
- Demand trend for the role

Before interpreting any salary number, classify the company type. Public compensation ranges are not equally reliable across company categories.

**Company type classification (required):**

Classify the employer into the closest category and state the confidence level:

| Company type | Typical comp reliability | Signals |
|--------------|--------------------------|---------|
| Public big tech / mature tech | High to medium | Public company, structured levels, large engineering org, repeatable hiring process |
| Growth-stage startup / VC-backed startup | Medium | Funded startup, competitive hiring market, may mix base + equity + bonus |
| Early-stage startup / pre-revenue startup | Medium to low | Small team, vague role scope, equity-heavy promises, unclear bands |
| Enterprise / traditional corporate | Medium | Formal HR process, stable base, slower bands, bonus may be discretionary |
| Agency / outsourcing / consulting vendor | Medium to low | Client allocation, project-based work, billability pressure, variable bonus |
| Local SMB / service business | Low | Small company, broad role, informal HR, "comprehensive salary" language |
| Sales / commission-heavy org | Low unless base is explicit | "OTE", "uncapped", commission, performance bonus, target-based pay |
| Recruiter / staffing listing | Low to medium | Third-party posting, range may reflect client budget rather than offer terms |
| Government / academic / nonprofit | Medium to high | Published grades/bands, but lower market competitiveness |
| Open-source community / education community | Medium to low | Community-led org, foundation/association sponsor, campus/community operations, unclear employment entity |

If the company type is uncertain, mark it as `Unknown` and default compensation reliability to the conservative canonical tier: `Low` until evidence improves it.

If the brand differs from the legal employer or posting entity, classify the **actual contract / hiring entity** first and mention the brand relationship separately. Example: a "Datawhale community" role posted by an association, school, vendor, or partner should be classified by that hiring entity, not by the Datawhale brand alone.

**Compensation reliability (required):**

First check whether the JD itself states a salary figure. If no advertised number exists, collapse this section to exactly two concise lines after the demand trend:

- **Company type:** {category or `Unknown`} — {confidence + one evidence phrase}
- **Compensation reliability:** {tier} — no advertised salary figure; skip component split, detailed market rows, and HR verification questions

When an advertised salary figure exists, split compensation into:

- **Advertised range:** the salary shown in the JD or public sources
- **Likely guaranteed base:** conservative estimate of fixed contract salary
- **Variable / conditional cash components:** bonus, commission, allowance, attendance bonus, KPI bonus, overtime, 13th salary, sign-on, or other cash tied to conditions
- **Expected stable cash:** what is likely recurring and reliable in cash, before tax unless local data supports a net estimate; exclude benefits
- **Non-cash benefits:** equity, insurance, pension, meals, transport, wellness, learning budget, equipment, or other benefits that are not guaranteed cash

Add a reliability tier:

| Tier | Meaning |
|------|---------|
| High | Salary is stated as base or backed by structured public bands / multiple consistent sources |
| Medium | Range is plausible but components are not fully separated |
| Low | Public number likely includes variable, attendance, commission, subsidy, or "up to" components |
| Unknown | No usable salary data |

Treat these phrases as low-reliability signals unless the fixed base is explicitly separated: "comprehensive salary", "total package", "up to", "OTE", "uncapped", "including allowances", "performance bonus included", "attendance bonus", "KPI bonus", "base + variable", "base + commission", "13th salary included", or unusually wide salary ranges.

When the advertised number may be inflated, say so plainly. Example: `Advertised 5k may represent 3k base + attendance / KPI / subsidy components; verify contract base before treating it as a 5k role.`

**Required HR verification questions when a salary figure exists:**

Include 3-6 concrete questions tailored to the JD and company type, such as:

- What is the fixed base salary written in the employment contract?
- Does the advertised range include bonus, commission, allowances, overtime, attendance, or KPI components?
- Is probation salary discounted?
- Are social insurance / pension / benefits calculated from base salary or full compensation?
- Which components are guaranteed monthly versus discretionary or target-based?
- If equity or bonus is mentioned, what is the vesting schedule, payout history, and realistic expected value?

When a salary figure exists, include a table with data and cited sources. If there is no data beyond the JD figure, state it instead of inventing. Do not present advertised compensation as real take-home pay unless the source explicitly supports that interpretation.

The table's **first row is always the JD's own advertised figure, verbatim** — before any researched market data:

```markdown
| Advertised (JD) | {verbatim figure or "not stated"} | JD |
```

Never blend the advertised figure with researched estimates or replace it with them — market research rows follow below it. This same verbatim figure goes into the Machine Summary `advertised_comp` key (see the report format).

## Block E — Customization Plan

| # | Section | Current status | Proposed change | Why |
|---|---------|---------------|------------------|---------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 changes to CV + Top 5 changes to LinkedIn to maximize match.

## Block F — Interview Plan

6-10 STAR+R stories mapped to JD requirements (STAR + **Reflection**):

| # | JD Requirement | STAR+R Story | S | T | A | R | Reflection |
|---|-----------------|-----------------|---|---|---|---|------------|

The **Reflection** column captures what was learned or what would be done differently. This signals seniority — junior candidates describe what happened, senior candidates extract lessons.

**Story Bank:** If `interview-prep/story-bank.md` exists, check if any of these stories are already there. If not, append new ones. Over time this builds a reusable bank of 5-10 master stories that can be adapted to any interview question.

**Selected and framed according to the archetype:**
- FDE → emphasize delivery speed and client-facing
- SA → emphasize architectural decisions
- PM → emphasize discovery and trade-offs
- LLMOps → emphasize metrics, evals, production hardening
- Agentic → emphasize orchestration, error handling, HITL
- Transformation → emphasize adoption, organizational change

Also include:
- 1 recommended case study (which of their projects to present and how)
- Red-flag questions and how to answer them (e.g., "why did you sell your company?", "do you have a team of reports?")

## Block G — Posting Legitimacy

Analyze the job posting for signals that indicate whether this is a real, active opening. This helps the user prioritize their effort on opportunities most likely to result in a hiring process.

**Ethical framing:** Present observations, not accusations. Every signal has legitimate explanations. The user decides how to weigh them.

### Signals to analyze (in order):

**1. Posting Freshness** (from the Playwright snapshot captured during the liveness gate, or in `auto-pipeline` Step 0; unavailable if only JD text was pasted):
- Date posted or "X days ago" -- extract from page
- Apply button state (active / closed / missing / redirects to generic page)
- If URL redirected to generic careers page, note it

**2. Description Quality** (from JD text):
- Does it name specific technologies, frameworks, tools?
- Does it mention team size, reporting structure, or org context?
- Are requirements realistic? (years of experience vs technology age)
- Is there a clear scope for the first 6-12 months?
- Is salary/compensation mentioned?
- What ratio of the JD is role-specific vs generic boilerplate?
- Any internal contradictions? (entry-level title + staff requirements, etc.)

**3. Company Hiring Signals** (use remaining queries from the bounded research budget, combine with Block D research):
- Search: `"{company}" layoffs {year}` -- note date, scale, departments
- Search: `"{company}" hiring freeze {year}` -- note any announcements
- If layoffs found: are they in the same department as this role?

**4. Reposting Detection** (from scan-history.tsv):
- Check if company + similar role title appeared before with a different URL
- Note how many times and over what period

**5. Role Market Context** (qualitative, no additional queries):
- Is this a common role that typically fills in 4-6 weeks?
- Does the role make sense for this company's business?
- Is the seniority level one that legitimately takes longer to fill?

**6. Employment Classification Risk** (from JD text; jurisdiction from `config/profile.yml` → `location.country`):

Every jurisdiction splits work into two buckets under different names: an "employment contract" carrying statutory protections and benefits, vs. a "service/labour/consulting contract" that doesn't — even when the day-to-day work looks identical from the outside. Candidates routinely can't tell which one a JD is offering until tax time or until a benefit they assumed they had turns out not to exist. Check the JD text against the jurisdiction-specific term list below (add a new row to extend to another country — this table is a data reference, not instruction logic, so extending it never requires touching the rule text):

| Jurisdiction | Contractor/services-status terms |
|---|---|
| Canada | "T4A", "independent contractor", "self-employed", "invoice for services" |
| US | "1099", "independent contractor", "W-2 not provided" |
| UK | "self-employed", "umbrella company", "outside IR35" / "inside IR35" |
| Other jurisdictions | "labour contract" vs "employment contract" phrasing, "service agreement", "consulting agreement" (e.g., 劳务合同 vs 劳动合同 in China) |

Plus a jurisdiction-agnostic structural check — **"contract position" alone is not enough to trigger this**, since plenty of legitimate fixed-term *employee* roles use that phrase. Only flag when the JD has explicit contractor-status wording (asks the candidate to "invoice," or to operate as a "consultant"/"freelancer," rather than being "hired"/"employed") **and** at least one corroborating omission (no benefits language, no vacation/PTO mention, no defined end date, no standard employment-standards phrasing, no mention of statutory deductions/withholding).

If this combination is present, append a short, non-alarmist note to the report (this is descriptive, never prescriptive — never tell the user to refuse a role):

> ⚠️ **Employment classification signal:** This posting uses language associated with contractor/services status rather than standard employee status — e.g. "{specific phrase found}". If eligibility for programs like CEC/PR depends on employee status, or if you want statutory benefits, deductions, and protections, confirm classification directly with the employer before accepting.

This signal does not change the High Confidence / Proceed with Caution / Suspicious tier below — it is orthogonal to ghost-job detection and is reported separately.

**7. AI-Buzzword vs. Infrastructure Mismatch** (from JD text, plus Block D research already gathered — no additional queries):

Some JDs describe the company the org *wants to become*, not the org as it is: heavy "AI enablement / digital transformation / process innovation" language sitting on top of infrastructure that is nowhere near ready for it. The candidate finds out only after burning a prescreen (or more) that the "AI" role is really digitization and backlog-cleanup work first, AI work maybe eventually. That can still be a fine role — but the candidate should know before applying, not after.

Check the JD for these three signal classes:

- **Buzzword density vs. role scope:** AI/transformation/innovation/enablement language is prominent, but the actual seniority, title, or listed responsibilities don't match ownership of transformation outcomes (e.g., a mid-level individual-contributor role expected to "drive AI transformation across the organization").
- **Team-size mismatch:** the JD mentions a small team (roughly 5 people or fewer) expected to own "transformation" outcomes for a large org — a common tell that the mandate outstrips the resourcing.
- **Industry base rate:** the company is in a traditional/legacy-heavy industry (manufacturing, aerospace/defense, industrial, heavy logistics) where basic digitization is often still incomplete — AI is being bolted onto a foundation that may not exist yet. This is a base rate, not a verdict: plenty of legacy-industry roles are genuine; it only counts as a signal in combination with the others.

**Only flag when 2+ of the three signal classes are present.** If flagged, append a short, non-alarmist note to the report (descriptive, never prescriptive — this can be exactly the kind of high-impact greenfield role some candidates want):

> ⚠️ **Buzzword/infrastructure mismatch signal:** This JD leans on AI/transformation language ("{specific phrases found}") while {signals observed: small team owning transformation outcomes / scope-seniority mismatch / legacy-heavy industry}. The day-to-day may be foundational digitization and backlog cleanup before any AI work. If you proceed, probe the actual state of their systems directly in interviews — e.g. "What are the top 3 most urgent things this role needs to fix right now?", "Which systems would I be working with, and how mature are they?" — rather than relying on the JD's framing.

This signal does not change the High Confidence / Proceed with Caution / Suspicious tier below — the posting can be entirely real and still oversell its AI maturity. It is orthogonal to ghost-job detection and is reported separately.

### Output format:

**Assessment:** One of three tiers:
- **High Confidence** -- Multiple signals suggest a real, active opening
- **Proceed with Caution** -- Mixed signals worth noting
- **Suspicious** -- Multiple ghost job indicators, investigate before investing time

**Signals table:** Each signal observed with its finding and weight (Positive / Neutral / Concerning).

**Context Notes:** Any caveats (niche role, government job, evergreen position, etc.) that explain potentially concerning signals.

### Edge case handling:
- **Government/academic postings:** Longer timelines are standard. Adjust thresholds (60-90 days is normal).
- **Evergreen/continuous hire postings:** If the JD explicitly says "ongoing" or "rolling," note it as context -- this is not a ghost job, it is a pipeline role.
- **Niche/executive roles:** Staff+, VP, Director, or highly specialized roles legitimately stay open for months. Adjust age thresholds accordingly.
- **Startup / pre-revenue:** Early-stage companies may have vague JDs because the role is genuinely undefined. Weight description vagueness less heavily.
- **No date available:** If posting age cannot be determined and no other signals are concerning, default to "Proceed with Caution" with a note that limited data was available. NEVER default to "Suspicious" without evidence.
- **Recruiter-sourced (no public posting):** Freshness signals unavailable. Note that active recruiter contact is itself a positive legitimacy signal.

---

## Cover Letter Draft (auto-generated after Block G)

After saving the report and recording in the tracker, append a cover letter draft to the report file under `## Cover Letter Draft`. This is a starting point — not the final letter. The user completes it via `/career-ops cover {slug}`.

**How to generate the draft:**

1. Read `cv.md` — select 4 achievement bullets most relevant to the JD's top requirements (exact wording, real metrics only)
2. Read `config/profile.yml` — extract candidate name, current role, years of experience
3. Write a 2-sentence opening based on the role title and JD mission language
4. Write a 1-paragraph profile intro from the cv.md summary, adapted to the JD domain
5. Leave the "Problems / Why this company / Approach" section as a placeholder — this requires user input
6. Detect and flag any gaps (domain mismatch, language requirement, start date urgency) so the user sees them immediately

**Draft format to append to the report:**

```markdown
## Cover Letter Draft

> Draft generated at evaluation time. Complete via `/career-ops cover {slug}` to fill in angles, confirm research, and generate the PDF.
> Gaps flagged below — address them during the cover flow.

---

**Opening** *(placeholder — refine with your "why this role" angle)*
{2-sentence opening based on JD role title and mission language}

**Profile introduction**
{1 paragraph from cv.md summary, adapted to JD domain and required competencies}

**Key achievements** *(selected from cv.md — exact wording preserved)*
- **{lead from cv.md},** {impact sentence with metric}.
- **{lead from cv.md},** {impact sentence with metric}.
- **{lead from cv.md},** {impact sentence with metric}.
- **{lead from cv.md},** {impact sentence with metric}.

**Problems I will solve** *(placeholder — requires company research + your input)*
> To be completed: what challenges does {company} face that you'd address? How would you approach them?

**Closing**
I am happy to discuss further at your convenience.

---

**Gaps flagged:**
{List any detected gaps — domain mismatch, language requirement, start date urgency, title mismatch. If none, write "None detected."}

**JD keywords to mirror** *(extracted for ATS + human read)*
{8-10 exact phrases from the JD}

---
*Run `/career-ops cover {slug}` to complete angles, confirm company research, and generate the PDF.*
```

Apply all language rules from `_shared.md` Professional Writing section to the draft content. No em dashes, no buzzwords, active voice, concrete claims only.

---

## Post-evaluation

**ALWAYS** after generating blocks A-G:

### 1. Save report .md

Save full evaluation in `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = next sequential number (3 digits, zero-padded). To allocate it atomically and prevent race conditions, you MUST run `node reserve-report-num.mjs` to claim the number (stdout returns `{###}`), write the report, and then run `node reserve-report-num.mjs --release {###}` to release the sentinel.
- `{company-slug}` = company name in lowercase, without spaces (use hyphens)
- `{YYYY-MM-DD}` = current date
- **Agency-mediated posting with unknown end employer (#1596):** slug is `confidential-{agency-slug}` (e.g. `042-confidential-hays-2026-07-06.md`). The file is NEVER renamed after the employer is revealed — update the title/header/YAML instead.

**Report format:**

```markdown
# Evaluation: {Company} — {Role}

**Date:** {YYYY-MM-DD}
**URL:**
**Via:** {agency/recruiter firm, or — for direct applications}
**Archetype:** {detected}
**Score:** {X/5}
**Legitimacy:** {High Confidence | Proceed with Caution | Suspicious}
**PDF:** {path or pending}

---

## Machine Summary
(YAML fence for downstream scripts — see requirement below)

## A) Role Summary
(full content of block A)

## B) Match with CV
(full content of block B)

## C) Level and Strategy
(full content of block C)

## D) Comp and Demand
(full content of block D)

## E) Customization Plan
(full content of block E)

## F) Interview Plan
(full content of block F)

## G) Posting Legitimacy
(full content of block G)

## H) Draft Application Answers
(only if score >= 4.5 — draft answers for the application form)

---

## Keywords extracted
(list of 15-20 keywords from the JD for ATS optimization)
```

**Machine Summary (required):** every report carries a `## Machine Summary` YAML fence directly after the header — same schema, exact field names, and rules as the "Machine Summary" block in `batch/batch-prompt.md` (do not duplicate the schema here; that file is the source of truth). It includes `advertised_comp`: the JD's own salary figure **verbatim** (e.g. `"80-90k EUR"`), or `null` when the JD states nothing — never estimated, never replaced with researched market data. This key seeds the advertised salary observation read by `node salary-gap.mjs`.

### 2. Record in tracker

**ALWAYS** record in `data/applications.md`:
- Next sequential number
- Current date
- Company — the END employer. If the JD is agency-mediated ("our client", agency domain, no employer named), ASK the user which agency it came through, use `?` as Company, and put a distinguishing descriptor in Notes (e.g. `fintech, Leeds`). Never write "Confidential" — the `?` marker is locale-invariant and can't collide with a real firm.
- Via (when the tracker has the column) — the agency/recruiter firm, `—` for direct. In the tracker-addition TSV, append it as a tagged extra field: `via={Agency}` (see the TSV format spec).
- Role
- Score: match average (1-5) — Read `modes/_custom.md` → Scoring Rules, if it exists, and apply its override here. Default (if absent or silent): average of block scores.
- Status: `Evaluated`
- PDF: ❌ (or ✅ if auto-pipeline generated PDF)
- Report: root-relative link `[001](reports/001-company-2026-01-01.md)` (when merged via `merge-tracker.mjs` it is normalized to be relative to the tracker's own dir, e.g. `../reports/...`; see #760)

**Tracker format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
```

With the optional Via column (intermediary channel, #1596) after Company:

```markdown
| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
```

### 3. Salary observations (desired ask only)

If — and only if — the user **explicitly stated a role-specific desired number for THIS application** in the conversation ("I'd ask 95k here"), append one `desired` line (source `user`) to `data/salary-observations.tsv` (create the file if missing; format per `docs/SCRIPTS.md` → salary-gap):

```text
{tracker#}\t{YYYY-MM-DD}\tdesired\t{amount}\t{currency}\tuser\t{short context note}
```

Never infer a desired number from the JD, the score, or past conversations. The profile default (`config/profile.yml` → `compensation.target_range`) needs no line — `salary-gap.mjs` reads it as the fallback. The advertised figure also needs no line: the report's `advertised_comp` **is** the advertised observation.
