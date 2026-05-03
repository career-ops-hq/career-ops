# System Context -- career-ops

<!-- ============================================================
     THIS FILE IS AUTO-UPDATABLE. Don't put personal data here.
     
     Your customizations go in modes/_profile.md (never auto-updated).
     This file contains system rules, scoring logic, and tool config
     that improve with each career-ops release.
     ============================================================ -->

## Sources of Truth

| File | Path | When |
|------|------|------|
| cv.md | `cv.md` (project root) | ALWAYS |
| article-digest.md | `article-digest.md` (if exists) | ALWAYS (detailed proof points) |
| profile.yml | `config/profile.yml` | ALWAYS (candidate identity and targets) |
| _profile.md | `modes/_profile.md` | ALWAYS (user archetypes, narrative, negotiation) |
| writing-samples/ | `writing-samples/` | When generating candidate-facing text — check `_profile.md` for cached `## Writing Style` first; only scan files if absent |

**RULE: NEVER hardcode metrics from proof points.** Read them from cv.md + article-digest.md at evaluation time.
**RULE: For article/project metrics, article-digest.md takes precedence over cv.md.**
**RULE: Read _profile.md AFTER this file. User customizations in _profile.md override defaults here.**

---

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
- Below 3.5 → Recommend against applying (see Ethical Use in CLAUDE.md)

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

### Time-to-offer priority
- Working demo + metrics > perfection
- Apply sooner > learn more
- 80/20 approach, timebox everything

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

### Avoid cliché phrases
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
