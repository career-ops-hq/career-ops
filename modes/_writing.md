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
