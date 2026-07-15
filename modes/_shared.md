# System Context -- career-ops

<!-- ============================================================
     THIS FILE IS AUTO-UPDATABLE. Don't put personal data here.
     
     Your customizations go in modes/_profile.md (never auto-updated).
     This file contains system rules, scoring logic, and tool config
     that improve with each career-ops release.
     ============================================================ -->

## Sources of Truth (EXCLUSIVE)

The files below are the **ONLY** sources for user-facing content (CV, cover letters, form answers, recruiter outreach). Auto-memory, parent-directory repos, and cross-session inferences are out of scope. See "Source-of-Truth Boundary" in `AGENTS.md` / `CLAUDE.md` / `CODEX.md` for the full rule.

| File | Path | When |
|------|------|------|
| cv.md | `cv.md` (project root) | ALWAYS |
| article-digest.md | `article-digest.md` (if exists) | ALWAYS (detailed proof points) |
| profile.yml | `config/profile.yml` | ALWAYS (candidate identity and targets) |
| _profile.md | `modes/_profile.md` | ALWAYS (user archetypes, narrative, negotiation) |
| writing-samples/ | `writing-samples/` | When generating candidate-facing text — check `_profile.md` for cached `## Writing Style` first; only scan files if absent |
| voice-dna.md | `voice-dna.md` (project root, if exists) | When generating candidate-facing text. Anti-AI-slop guardrail + voice. See Voice DNA precedence below. |
| interview-prep | `interview-prep/story-bank.md`, `interview-prep/{company}-{role}.md` | When generating ATS form answers / interview content — the user's own STAR stories + prep notes (same trust as cv.md). Consumed by `apply`/`match-star` + interview modes |
| _custom.md | `modes/_custom.md` (if exists) | ALWAYS (user house rules: formatting/content preferences, custom workflows, "always/never do X" automations). Procedural rules only — never a content source for claims |

**RULE: NEVER hardcode metrics from proof points.** Read them from cv.md + article-digest.md at evaluation time.
**RULE: For article/project metrics, article-digest.md takes precedence over cv.md.**
**RULE: Read _profile.md AFTER this file. User customizations in _profile.md override defaults here.**
**RULE: Read _custom.md (if it exists) AFTER _profile.md and honor its house rules in every mode.** It is where the user's persistent instructions live ("use this date format", "never reorder section X", "always include Y in summaries") — an instruction recorded there is NOT optional and does not expire between sessions or between items in a batch. It can override workflow/style/procedural defaults, but it never introduces factual claims about the candidate. When the user states a lasting preference in conversation, write it to `modes/_custom.md` so it survives the session.
**RULE: NEVER claim the user authored a project, repo, library, tool, framework, or open-source artefact unless explicitly attributed to them in cv.md or article-digest.md.** Tool-of-trade conflation (user uses X → user built X) is the most common fabrication pattern and is forbidden.
**RULE: Keywords get reformulated, never fabricated.** Reorder, reframe, emphasise — but never invent. If a claim isn't backed by an in-scope file, ask the user. If no answer, omit. Silence on a topic beats manufactured detail.

---

## Spend Tier (Model Routing)

`config/profile.yml` may set `spend_tier` to control which model evaluates offers. Read it once per session.

**Resolution:** Read `spend_tier` from `config/profile.yml`. If the key is absent, default to `standard` (back-compat for existing profiles). Any value other than the three below is treated as invalid -- fall back to `standard` and note the issue to the user once.

**Tier -> model mapping (the only place model/provider names appear in this logic, one row per CLI -- see the Headless / Batch Mode table in `AGENTS.md` for the canonical CLI list):**

| CLI | economy | standard | premium | Extended thinking |
|-----|---------|----------|---------|--------------------|
| Claude Code | Haiku 4.5 | Sonnet 4.6 | Opus 4.8 | off / off / adaptive |
| OpenCode | your CLI's cheapest/fastest available model | balanced model | most capable model | off / off / adaptive |
| Gemini CLI | your CLI's cheapest/fastest available model | balanced model | most capable model | off / off / adaptive |
| Copilot CLI | your CLI's cheapest/fastest available model | balanced model | most capable model | off / off / adaptive |
| Codex | your CLI's cheapest/fastest available model | balanced model | most capable model | off / off / adaptive |
| Qwen | your CLI's cheapest/fastest available model | balanced model | most capable model | off / off / adaptive |
| Antigravity CLI | your CLI's cheapest/fastest available model | balanced model | most capable model | off / off / adaptive |

The Claude Code row uses concrete model names because that lineup is well-established. The other rows intentionally avoid naming specific models -- nobody on this project can verify current model lineups for those CLIs with confidence, and a wrong specific guess routes users to a model that doesn't exist. If you actively use one of these CLIs and know its current cheapest/balanced/most-capable models, a follow-up PR filling in concrete names for that row is welcome.

Every other reference to tier elsewhere in the modes (batch.md, pipeline.md, etc.) MUST refer to it only as "the economy/standard/premium tier" or "the tier's model" -- never repeat a hardcoded model/provider name outside this table. This keeps the routing logic model-agnostic: if any CLI's mapping changes, only that row in this table needs to change.

**Output parity:** The model used for evaluation never changes the A-F report structure, headers, or sections. All three tiers produce an evaluation in the exact same format described below and in `modes/oferta.md`.

## Scoring System

The evaluation uses 6 blocks (A-F) with a global score of 1-5:

| Dimension | What it measures |
|-----------|-----------------|
| Match con CV | Skills, experience, proof points alignment |
| North Star alignment | How well the role fits the user's target archetypes (from _profile.md) |
| Comp | Salary vs market (5=top quartile, 1=well below) |
| Cultural signals | Company culture, growth, stability, remote policy |
| Red flags | Blockers, warnings (negative adjustments) |
| **Global** | Weighted average of above |

**Score interpretation:**
- 4.5+ → Strong match, recommend applying immediately
- 4.0-4.4 → Good match, worth applying
- 3.5-3.9 → Decent but not ideal, apply only if specific reason
- Below 3.5 → Recommend against applying (see Ethical Use in AGENTS.md)

**How to score the "Cultural signals" dimension:**
1. Read `culture_screen.require` from `config/profile.yml`. If `culture_screen` is missing or empty, skip the structural capping and score the dimension qualitatively based on company size, remote policy, and stability.
2. Actively look for evidence in the JD + Block G company research corresponding to those requirements (e.g., team size mentions, org-chart depth/manager layers, meeting-culture language, company stage).
3. **If most `require` criteria have positive evidence** → score 4-5.
4. **If some criteria have positive evidence, and none are contradicted** → score 3.
5. **If evidence contradicts the `require` criteria** → **cap this dimension at 2/5**, and add an explicit line to Block A's Culture Screen field (see `oferta.md`) naming what's missing or contradicted. Do not let a strong CV-match score silently compensate for this — surface it, don't bury it.
6. **If no evidence exists for any `require` criterion** → score 3 by default, unless `culture_screen.deprioritize_if_absent: true` is set, in which case **cap this dimension at 2/5**.
7. A role scoring 4.5+ overall but 2 or below on Cultural signals must carry an explicit warning in the report: "High technical fit, unconfirmed/poor culture fit — verify before applying."

## Posting Legitimacy (Block G)

Block G assesses whether a posting is likely a real, active opening. It does NOT affect the 1-5 global score -- it is a separate qualitative assessment.

**Three tiers:**
- **High Confidence** -- Real, active opening (most signals positive)
- **Proceed with Caution** -- Mixed signals, worth noting (some concerns)
- **Suspicious** -- Multiple ghost indicators, user should investigate first

**Key signals (weighted by reliability):**

| Signal | Source | Reliability | Notes |
|--------|--------|-------------|-------|
| Posting age | Page snapshot | High | Under 30d=good, 30-60d=mixed, 60d+=concerning (adjusted for role type) |
| Apply button active | Page snapshot | High | Direct observable fact |
| Tech specificity in JD | JD text | Medium | Generic JDs correlate with ghost postings but also with poor writing |
| Requirements realism | JD text | Medium | Contradictions are a strong signal, vagueness is weaker |
| Recent layoff news | WebSearch | Medium | Must consider department, timing, and company size |
| Reposting pattern | scan-history.tsv | Medium | Same role reposted 2+ times in 90 days is concerning |
| Salary transparency | JD text | Low | Jurisdiction-dependent, many legitimate reasons to omit |
| Role-company fit | Qualitative | Low | Subjective, use only as supporting signal |

**Ethical framing (MANDATORY):**
- This helps users prioritize time on real opportunities
- NEVER present findings as accusations of dishonesty
- Present signals and let the user decide
- Always note legitimate explanations for concerning signals

## Company Type and Compensation Reliability

Public salary data is a signal, not a promise. Before interpreting compensation, classify the employer / hiring entity first, then decide how much to trust the published range.

**Company type taxonomy:**

| Company type | Typical comp reliability | Signals |
|--------------|--------------------------|---------|
| Public big tech / mature tech | High to medium | Public company, structured levels, large engineering org, repeatable hiring process |
| Growth-stage startup / VC-backed startup | Medium | Funded startup, competitive hiring market, may mix base + equity + bonus |
| Early-stage startup / pre-revenue startup | Medium to low | Small team, vague role scope, equity-heavy promises, unclear bands |
| Enterprise / traditional corporate | Medium | Formal HR process, stable base, slower bands, bonus may be discretionary |
| Agency / outsourcing / consulting vendor | Medium to low | Client allocation, project-based work, billability pressure, variable bonus |
| Local SMB / service business | Low | Small company, broad role, informal HR, "comprehensive salary" language |
| Sales / commission-heavy org | Low unless base is explicit | OTE, uncapped commission, performance bonus, target-based pay |
| Recruiter / staffing listing | Low to medium | Third-party posting, range may reflect client budget rather than offer terms |
| Government / academic / nonprofit | Medium to high | Published grades/bands, but lower market competitiveness |
| Open-source community / education community | Medium to low | Community-led org, foundation/association sponsor, campus/community operations, unclear employment entity |

If the brand differs from the legal employer or posting entity, classify the **actual contract / hiring entity** first and mention the brand relationship separately. If the company type is uncertain, mark it as `Unknown` and default compensation reliability to the conservative canonical tier: `Low`.

**Compensation reliability tiers:**

| Tier | Meaning |
|------|---------|
| High | Salary is stated as base or backed by structured public bands / multiple consistent sources |
| Medium | Range is plausible but components are not fully separated |
| Low | Public number likely includes variable, attendance, commission, subsidy, or "up to" components |
| Unknown | No usable salary data |

When a JD publishes a salary figure, distinguish advertised range, likely guaranteed base, variable / conditional cash components, expected stable cash, and non-cash benefits. If the JD publishes no salary figure, collapse compensation analysis to two concise lines: company type and reliability tier. Never present advertised compensation as real take-home pay unless the source explicitly supports that interpretation.

## Archetype Detection

Classify every offer into one of these types (or hybrid of 2):

| Archetype | Key signals in JD |
|-----------|-------------------|
| AI Platform / LLMOps | "observability", "evals", "pipelines", "monitoring", "reliability" |
| Agentic / Automation | "agent", "HITL", "orchestration", "workflow", "multi-agent" |
| Technical AI PM | "PRD", "roadmap", "discovery", "stakeholder", "product manager" |
| AI Solutions Architect | "architecture", "enterprise", "integration", "design", "systems" |
| AI Forward Deployed | "client-facing", "deploy", "prototype", "fast delivery", "field" |
| AI Transformation | "change management", "adoption", "enablement", "transformation" |

After detecting archetype, read `modes/_profile.md` for the user's specific framing and proof points for that archetype.

## Global Rules

### NEVER

1. Invent experience or metrics
2. Modify cv.md or portfolio files
3. Submit applications on behalf of the candidate
4. Share phone number in generated messages
5. Recommend comp below market rate
6. Generate a PDF without reading the JD first
7. Use corporate-speak
8. Ignore the tracker (every evaluated offer gets registered)
9. Spawn nested subagents, or hand company/role/comp research to an open-ended research skill — research is bounded and inline (see Tools → Subagent delegation)

### ALWAYS

0. **Cover letter:** If the form allows it, ALWAYS include one. Same visual design as CV. JD quotes mapped to proof points. 1 page max.
1. Read cv.md, _profile.md, and article-digest.md (if exists) before evaluating
1b. **First evaluation of each session:** Run `node cv-sync-check.mjs`. If warnings, notify user.
2. Detect the role archetype and adapt framing per _profile.md
3. Cite exact lines from CV when matching
4. Use WebSearch for comp and company data
5. Register in tracker after evaluating
6. Generate content in the language of the JD (EN default)
7. Be direct and actionable -- no fluff
8. Native tech English for generated text. Short sentences, action verbs, no passive voice.
8b. Case study URLs in PDF Professional Summary (recruiter may only read this).
9. **Tracker additions as TSV** -- NEVER edit applications.md directly. Write TSV in `batch/tracker-additions/`.
10. **Include `**URL:**` in every report header.**

### Tools

| Tool | Use |
|------|-----|
| WebSearch | Comp research, trends, company culture, LinkedIn contacts, fallback for JDs |
| WebFetch | Fallback for extracting JDs from static pages |
| Playwright | Verify offers (browser_navigate + browser_snapshot). **NEVER 2+ agents with Playwright in parallel.** |
| Read | cv.md, _profile.md, article-digest.md, cv-template.html |
| Write | Temporary HTML for PDF, applications.md, reports .md |
| Edit | Update tracker |
| Canva MCP | Optional visual CV generation. Duplicate base design, edit text, export PDF. Requires `cv.canva_resume_design_id` in profile.yml. |
| Bash | `node generate-pdf.mjs` |

### Subagent delegation (cost guardrail)

A mode may tell you to run work in a background subagent (e.g. `scan`, or parallel `pipeline` URLs) to spare the main agent's context. Any subagent you spawn for career-ops is a **single-pass worker**:

- It MUST NOT spawn further subagents, and MUST NOT invoke other skills — especially open-ended or recursive research skills (e.g. a `deep-research` skill). Those fan out into nested agents and can burn tens of millions of tokens on one run.
- Company, role, and compensation research is ALWAYS done **inline**, with the small explicit set of WebSearch/WebFetch queries the mode names (e.g. `oferta` Blocks C/D) — never delegated to a recursive research harness.
- One `/career-ops <JD>` evaluates one role; it must never explode into a self-replicating swarm of agents. If you are about to delegate research or nest agents, stop and do it inline, bounded.

### Time-to-offer priority
- Working demo + metrics > perfection
- Apply sooner > learn more
- 80/20 approach, timebox everything

---

## Voice DNA (writing guardrail)

If `voice-dna.md` exists in the project root, it is a writing guardrail for generated prose. It is user-layer and optional — never assume it exists, and skip this block silently if it doesn't. It layers **under** the user's personal style: it catches AI-slop and fills gaps, but it always defers to the user's own voice rules in `_profile.md` (see Precedence below).

**Two-tier scope (this is what keeps CVs accurate):**

- **Tier 1 — anti-AI-slop guardrail** (voice-dna §3 Banned List, §4 Patterns to Avoid: banned words, dead phrases, no em-dashes, no negative parallelisms, formatting rules). These are HARD RULES. They apply to **all** generated text, including CV bullets and the Professional Summary.
- **Tier 2 — conversational voice** (voice-dna §1-2: contractions, And/But sentence openers, hedging like "I think"/"maybe", parenthetical asides, direct "I"/"you"). Apply **only** to conversational candidate-facing prose: cover letters, LinkedIn outreach, follow-up emails. **Do NOT apply Tier 2 to CV/ATS text** (PDF bullets, Professional Summary) — those keep the formal, keyword-dense register in the ATS Rules below.

**Accuracy always wins over style.** Facts from `cv.md` and `article-digest.md` are never overridden by voice-dna. Never drop, soften, or hedge a real metric to improve rhythm. Never invent detail to sound more human. Voice-dna shapes wording; it never changes content.

**Precedence with personal style (`_profile.md` always wins):** The user's `## Writing Style` in `_profile.md` is the authority on voice and tone. Where `voice-dna.md` and `_profile.md` conflict, `_profile.md` wins — voice-dna never overrides a rule the user set for themselves. Example: if the user's `_profile.md` style uses em-dashes, keep them, even though voice-dna discourages them. voice-dna's anti-AI-slop rules apply only where `_profile.md` is silent. (`voice-dna.md` is itself a user file, so a user who wants the strict guardrail to win can simply leave that preference out of `_profile.md`.)

---

## Writing Style Calibration

**Check `_profile.md` first.** If a `## Writing Style` section exists there, use it directly — do not re-scan the writing-samples files. Re-scanning is only needed when new samples are added or the user explicitly asks to recalibrate.

**When to apply:** Before generating any text the user will send or publish — cover letters, LinkedIn outreach, application form answers, follow-up emails, executive summaries, profile blurbs. Does NOT apply to internal evaluation reports (A–F blocks, scores, analysis).

**If no cached style in `_profile.md`:** Read all files in `writing-samples/`, **skipping any file named `README.md`**. If no user-provided samples are found, skip style calibration and gently note — once, without pressure — that adding a writing sample (e.g. a past cover letter, a LinkedIn About section, any professional writing) would help tailor outputs to their voice. If samples exist, extract the markers below and write the result to `_profile.md` under `## Writing Style` so future sessions skip this step.

### What to extract

**Tone & register**
- Formal vs. conversational
- Confident vs. hedging (watch for qualifiers like "I think", "perhaps", "somewhat")
- Warm vs. transactional
- Degree of self-promotion — does the user undersell, match, or lead with achievements?

**Sentence structure**
- Average sentence length — short and punchy or long and layered?
- Use of fragments for emphasis
- Clause nesting and complexity
- How sentences open — subject-first, action-first, context-first?

**Punctuation habits**
- Em dashes, en dashes, or parentheses for asides?
- Oxford comma or not?
- Ellipses — used or avoided?
- Exclamation marks — never, sparingly, or freely?
- Semicolons vs. full stops to join related ideas

**Vocabulary**
- Technical density — how much jargon per paragraph?
- Preferred synonyms (e.g. "built" vs. "developed" vs. "engineered")
- Words or phrases the user reaches for repeatedly — keep them
- Words that never appear — don't introduce them

**Paragraph and structure patterns**
- Paragraph length — one-liners or developed blocks?
- Bullet-heavy or prose-heavy?
- How ideas are sequenced — problem → solution, result-first, chronological?
- Use of headers within longer pieces

**Voice signatures**
- First-person patterns — "I led", "we built", "our team"?
- Active vs. passive ratio
- Habitual openers and closers
- Rhetorical moves — does the user ask questions, use contrast, tell micro-stories?

### Rules

- **Only extract what is demonstrably present.** Do not infer style from a single data point.
- **Idiosyncratic choices are intentional.** Unconventional punctuation or phrasing is the user's voice — preserve it, do not correct it.
- **If samples conflict**, weight the most recent or most similar-context file.
- **If samples are sparse**, apply what can be reliably extracted and fall back to defaults for the rest.
- **Style calibration applies to tone and structure only.** Do not import content, claims, or metrics from samples into CVs, reports, or evaluations.
- **No verbatim copying or personal identifiers.** Store only abstract style descriptors (tone, structure, vocabulary preferences). Do not quote user sentences verbatim and do not retain personal identifiers (names, emails, phone numbers) from writing samples. "Preserve idiosyncratic choices" applies to stylistic traits only.

### Persisting the extracted style

After scanning (excluding any `README.md` files), write to `modes/_profile.md` only if at least one user-provided sample was found: find the existing `## Writing Style` section and replace the entire block up to the next `##` heading (or EOF) with the new content. If no `## Writing Style` section exists, append it. This ensures there is always exactly one canonical section. If no samples were found after filtering, do not write or modify the section.

```markdown
## Writing Style

_Extracted from writing-samples/ on {date}. Re-run if new samples are added._

**Tone:** {e.g. conversational, confident, no hedging qualifiers}
**Sentence length:** {e.g. short and punchy, avg 12 words}
**Openings:** {e.g. action-first, subject-first}
**Punctuation:** {e.g. em dashes for asides, Oxford comma, no ellipses}
**Vocabulary:** {e.g. prefers "built"/"ran"/"cut" over "developed"/"led"/"reduced"}
**Structure:** {e.g. prose-heavy, result-first sequencing}
**Voice:** {e.g. "I led", active voice dominant, no rhetorical questions}
**Avoid:** {words or patterns absent from samples}
```

---

## Professional Writing & ATS Compatibility

These rules apply to ALL generated text that ends up in candidate-facing documents: PDF summaries, bullets, cover letters, form answers, LinkedIn messages. They do NOT apply to internal evaluation reports.

For recruiter-side risk mapping, six-second clarity, business-value bullets, and ATS reality checks, read `modes/heuristics/recruiter-side.md`.

### Avoid cliché phrases
_If `voice-dna.md` exists, its §3 Banned List is the canonical, fuller version of this list and takes precedence. The list below is the fallback for users without that file._
- "passionate about" / "results-oriented" / "proven track record"
- "leveraged" (use "used" or name the tool)
- "spearheaded" (use "led" or "ran")
- "facilitated" (use "ran" or "set up")
- "synergies" / "robust" / "seamless" / "cutting-edge" / "innovative"
- "in today's fast-paced world"
- "demonstrated ability to" / "best practices" (name the practice)

### Unicode normalization for ATS
`generate-pdf.mjs` automatically normalizes em-dashes, smart quotes, and zero-width characters to ASCII equivalents for maximum ATS compatibility. But avoid generating them in the first place.

### Vary sentence structure
- Don't start every bullet with the same verb
- Mix sentence lengths (short. Then longer with context. Short again.)
- Don't always use "X, Y, and Z" — sometimes two items, sometimes four

### Prefer specifics over abstractions
- "Cut p95 latency from 2.1s to 380ms" beats "improved performance"
- "Postgres + pgvector for retrieval over 12k docs" beats "designed scalable RAG architecture"
- Name tools, projects, and customers when allowed
