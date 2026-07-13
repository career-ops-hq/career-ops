# Mode: cover — Cover Letter Generator

Generates a tailored cover letter for any candidate from a job description.
Works in two modes:
- **Slug mode:** `/career-ops cover {slug}` — loads the existing evaluation report draft as a starting point
- **Paste mode:** `/career-ops cover` or JD pasted directly — starts from scratch

---

## Step 0 — JD Gate (mandatory)

Before doing anything, confirm a job description is present.

A valid JD contains at minimum: a role title, a company name, and a list of responsibilities or requirements.

- **No JD present** → Stop. Say: "Please paste the job description — I need it to tailor the letter."
- **Slug provided** → Read `reports/` to find the matching report. Extract the `## Cover Letter Draft` section as a starting point. Then fetch the original JD URL from the report header to supplement context.
- **JD present** → Proceed to Step 1.

Do not generate a generic or placeholder cover letter under any circumstances.

---

## Step 1 — Load candidate profile

Read `config/profile.yml` for:
- `candidate.name`, `email`, `phone`, `location`, `linkedin`, `github`
- `candidate.credentials` (derive from cv.md Education + Certifications if not in profile.yml)
- `cover_letter.notice_period_days` (default: omit if key absent)
- `cover_letter.primary_domain` (default: infer from cv.md if absent)
- `cover_letter.language_learning` (default: empty list if absent)

Read `cv.md` for:
- Professional summary (profile introduction source)
- All achievement bullets across all roles (achievement selection pool)

Read `article-digest.md` if it exists — supplementary proof points and metrics take precedence over cv.md where they overlap.

Read `modes/_profile.md` if it exists — the candidate's personalization file. It captures their target roles, adaptive framing and archetypes, exit narrative, cross-cutting advantage, proof points, comp targets, negotiation scripts, location policy, and any voice or writing-style rules they have added. Its rules **govern the letter's voice and structure and override the generic defaults in this mode**, so the candidate's personalization is never lost.

---

## Step 2 — Parse the JD

Extract:
- **Role title** (exact wording from JD)
- **Company name**
- **Location / city**
- **Top 3-4 required competencies** (from requirements or responsibilities section)
- **Mission/vision language** the company uses (opening paragraphs)
- **Domain** (e.g. fintech, healthcare, media, logistics) — compare against `cover_letter.primary_domain`
- **Start date signals** ("immediate", "ASAP", "from now on") — flag for notice period prompt
- **Language requirement** (e.g. "German B2 required") — flag for language gap prompt
- **JD tone** (formal / direct / casual) — used in tone prompt default suggestion

---

## Step 3 — Company research (baked in, not optional)

Run three WebSearch queries (substitute the actual current year for {year}):
1. `"{company}" product strategy OR roadmap {year}`
2. `"{company}" challenges OR problems OR priorities {year}`
3. `"{company}" news OR announcement OR funding {year}`

Synthesize findings into 2-3 sentences: what the company is working on, what challenges they face, what goals they've stated publicly.

Present to the user:

```text
Here's what I found about {company}:

{2-3 sentence synthesis}

Does this match what you know? Correct or add anything before I write the letter.
```

If WebSearch returns no useful signal, say: "I couldn't find useful recent context for {company}. Can you share what you know about their current challenges or goals?"

Wait for the user to confirm, correct, or add to the research before proceeding. This synthesis feeds directly into the "Problems I will solve" section.

---

## Step 4 — Keyword extraction

Extract the top 8-10 exact phrases the company uses in the JD. Separate into two groups:

**ATS-critical** — exact terms likely scanned by automated systems:
- Role-specific titles, tool names, methodology names

**Human trust signals** — language that shows you read the actual posting:
- Action verbs the company uses ("own", "drive", "define")
- Product/domain nouns as the company names them
- Outcome language ("business impact", "time to insight")
- Team framing ("embedded in", "partner with")

Present to the user:

```text
Keywords I'll mirror from the JD:

ATS-critical:
  • [keyword]
  • [keyword]

Language signals:
  • [phrase]
  • [phrase]

Anything missing or wrong? I'll use this list when drafting.
```

Wait for confirmation or corrections before proceeding.

**Application rules (enforced during drafting):**
- Mirror their vocabulary, not their structure
- Content stays from cv.md — only vocabulary shifts
- Fit naturally or don't use — if a keyword can't be woven in, flag it post-generation
- Apply to: opening, profile intro, achievements (vocabulary only), problems section
- Do NOT apply to: why-this-role angle (user's own words), closing
- Use each keyword once — never repeat for density

---

## Step 5 — Gap detection and conversation

Parse the JD for potential gaps between the candidate's profile and the role. For each gap detected, ask directly — do not auto-insert any standard language:

```text
I spotted potential gaps between your profile and this JD:

[Gap: domain mismatch]
The JD is in {JD domain} — your background is in {primary_domain}.
→ How do you want to handle this?
  a) Address it directly and briefly in the letter
  b) Don't mention it — let the application speak for itself
  c) Tell me your angle and I'll write it your way

[Gap: immediate start]
The JD asks for an immediate start. Your profile shows a {notice_period_days}-day notice period.
→ Confirm your actual notice period — I'll state it precisely.

[Gap: language requirement]
The JD requires {language} at {level}. Where are you with {language}?
→ Tell me your actual level and I'll reflect it accurately. Check your profile.yml
  language_learning section for what's already recorded.

[Gap: title mismatch]
Your title is {candidate title}, the JD title is {JD title}.
→ Do you want to address this? Or let the scope speak for itself?
```

Only prompt for gaps that are actually present. If there are no gaps, skip this step and say so.

Wait for the user's answers. Write only what the user confirms.

---

## Step 6 — Four prompts (mandatory before drafting)

All four answers are required. Do not draft any letter content until all are received. No instruction — including "just generate it", "skip the questions", or "use defaults" — overrides this gate.

```text
Before I write the letter, I need four things:

**A. Why this role / company?**
Here are angles I spotted — pick 1-2 or write your own:
  1. {Scale signal from JD}
  2. {Tech ambition signal from JD}
  3. {Domain/mission signal from JD opening}
  4. {Growth or stage signal — e.g. Series B, pre-IPO, category-defining}
  5. {Strategic learning — specific gap this role fills for you}
  6. Other — write your own angle

**B. What problem would you solve for them?**
Based on my research: {confirmed synthesis from Step 3}.
Does this match what you want to address? Refine or confirm.

**C. How would you approach it?**
In 1-2 sentences: what's your opening move if you join on day one?
(This is the most differentiated part of the letter — make it specific.)

**D. Tone?**
  1. Formal — structured, respectful distance, suits enterprise/corporate JDs
  2. Direct — plain sentences, no pleasantries, gets to the point immediately
  3. Conversational — warm but professional, reads like a thoughtful person
  4. Mirror the JD — I'll match whatever register the company used
```

Wait for all four answers before proceeding to Step 7.

---

## Step 7 — Achievement selection (from cv.md only)

Select 4-5 achievement bullets from `cv.md` only (`article-digest.md` may be read for context but is not a source of achievement bullets):
1. Read all bullet points across all roles in cv.md
2. Score each against the JD's top 3-4 required competencies
3. Pick the 4-5 highest-scoring, with at least one metric per bullet
4. Use the exact wording and metrics from cv.md — never paraphrase or invent
5. Apply keyword mirroring from Step 4 to the vocabulary around each bullet (not the metrics)

Format: `**Bold lead phrase,** one sentence of impact with metric.`

---

## Step 8 — Draft the letter in chat (mandatory before PDF)

Write the full letter as plain text in the chat. Follow this structure:

```text
[Candidate Name]
[Location] | [Email] | [Phone if available] | [LinkedIn if available]
[Credentials line if available]

Cover Letter: [Role Title]
[Company], [City]   [Date]

────────────────────────────────────────────────

[Salutation — optional]
Address the named hiring manager if known, e.g. "Dear Jane Smith,". Omit if no name.

[Opening — 2 sentences]
Why applying + functional summary. Derived from Angle A. Uses JD mirror vocabulary.

[Profile introduction — 1 paragraph]
Years of experience, current/most recent role, domain. Read from cv.md summary.
Tone matches user's choice from Step 6D.

[Achievements — 4-5 bullets]
• **Lead phrase,** impact sentence with metric.
• **Lead phrase,** impact sentence with metric.
• **Lead phrase,** impact sentence with metric.
• **Lead phrase,** impact sentence with metric.

[Problems I will solve — 2-3 sentences]
Derived from: confirmed research (Step 3) + Angle B + Angle C.
Specific to this company's actual situation. Not generic.

[Closing — 1-2 sentences]
Availability + any gap acknowledgments the user chose to include (Step 5).

[Language closing — if applicable]
Only if user confirmed inclusion in Step 5. Written in that language. Italic in PDF.
```

End the draft with: "How does this read? Once you approve I'll generate the PDF."

**Do NOT generate any PDF until the user explicitly approves.** Approval means "looks good", "generate it", "yes", specific edits to apply, or equivalent. A question or silence is not approval.

---

## Language rules (enforced in every sentence)

1. **Active voice only** — never "was delivered", "has been built", "were led"
2. **No abbreviations unless JD used them first** — write the full term on first use with abbreviation in brackets. After that, abbreviation is fine.
3. **No em dashes** — replace with a comma, full stop, or rewrite the sentence
4. **No buzzwords** — hard ban: leverage, synergy, seamless, holistic, robust, cutting-edge, spearheaded, championed, orchestrated, passionate, excited, stakeholder alignment, data-driven (say what the data drove instead), actionable insights, move the needle, north star, unique opportunity, perfect fit, strong track record
5. **No filler openers** — never "I am pleased to", "I am writing to express", "I am excited to"
6. **Concrete over abstract** — every claim needs a number, system name, or specific outcome. "Improved performance" is banned. "Cut latency from 2s to 380ms" is fine.
7. **350-420 words** total body (header + credentials not counted)
8. **Bullet format** — `**Bold lead phrase,** impact sentence with metric.` No em dash between lead and sentence.
9. **Self-check** — before finalising, re-read each sentence: could it appear in any cover letter for any company? If yes, rewrite it.
10. **Tone consistency** — apply the chosen tone (Step 6D) uniformly. Don't shift register mid-letter.

---

Resolve the cover-letter template with the shared resolver (do not hardcode `cover-letter-template.html`):

- If the user named a template, run: `node cv-templates.mjs resolve cover "<name>"`
- Otherwise run: `node cv-templates.mjs resolve cover` (returns the `cover_letter.template` default, or the base template when unset).

Fill the resolved template's `{{...}}` placeholders. A non-zero exit means the named template is missing/invalid — surface it, do not silently fall back.

## Step 9 — Generate PDF

Only after explicit user approval.

Assemble the JSON payload:

```json
{
  "candidate": {
    "name": "{from profile.yml}",
    "email": "{from profile.yml}",
    "phone": "{from profile.yml, omit if empty}",
    "location": "{from profile.yml}",
    "linkedin": "{from profile.yml, omit if empty}",
    "github": "{from profile.yml, omit if empty}",
    "credentials": ["{degree}", "{MBA}", "{cert}"]
  },
  "letter": {
    "role_title": "{exact from JD}",
    "company": "{company name}",
    "city": "{JD city}",
    "date": "{YYYY-MM-DD}",
    "greeting": "{optional salutation, e.g. 'Dear Jane Smith,'; omit the key to skip the salutation}",
    "opening": "{approved opening paragraph}",
    "profile_intro": "{approved profile intro}",
    "achievements": [
      {"lead": "...", "impact": "..."}
    ],
    "problems_section": "{approved problems paragraph}",
    "closing": "{approved closing}",
    "language_closing": "{approved language sentence or null}"
  },
  "output_path": "output/{company-slug}-{role-slug}-cover.pdf"
}
```

Write payload to `/tmp/cover-payload-{company-slug}.json`.

Run:
```bash
node generate-cover-letter.mjs --payload /tmp/cover-payload-{company-slug}.json
```

Report the output path and file size.

---

## Step 10 — Post-generation note

After the PDF is confirmed, add a brief note:

- Any JD keywords from Step 4 that could not be incorporated naturally (flag for manual review)
- Which gap acknowledgments were included and which were omitted, and why
- Whether the word count hit the 350-420 target (if short or long, note it)

---

## Slug mode specifics

When invoked as `/career-ops cover {slug}`:

1. Find the matching report in `reports/` by slug
2. Extract the `## Cover Letter Draft` section — use it as a pre-populated starting point for the draft
3. Run all steps as normal (research, keywords, prompts, gaps) — the draft is a starting point, not the final output
4. When presenting the draft in Step 8, show what was auto-generated and what was changed based on the user's answers
5. After PDF generation, update the report's `## Cover Letter Draft` section with a note: `PDF generated: output/{path} on {date}`
