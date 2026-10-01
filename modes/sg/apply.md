# Mode: apply — Live Application Assistant (Singapore market)

> Apply `voice-dna.md` (if present) to free-text answers and cover-letter fields — full guardrail, conversational voice included (Tier 1 + 2). See `_writing.md` → Voice DNA.

Interactive mode for when the candidate is filling out a Singapore application
form (MyCareersFuture, JobStreet, Workday SG instances, company portals). Reads
what is on the screen, loads the previous evaluation context, and generates
personalized answers for each form question.

## Base workflow

Follow `modes/apply.md` verbatim: DETECT → IDENTIFY → SEARCH → LOAD →
PREFLIGHT (blacklist, cross-channel, repeat-application checks) → ANALYZE →
GENERATE → PRESENT → PERSIST. The steps below are Singapore-specific field
guidance for the GENERATE step.

## Singapore-specific fields

- **Work authorization / right to work:** "Employment Pass sponsorship required.
  I am not currently authorized to work in Singapore." Never select or imply
  Singaporean/PR status. If the form only offers "Are you authorized to work
  in Singapore? Yes/No" with no sponsorship nuance, answer No and add the
  sponsorship need in a free-text field.
- **Require sponsorship (now or in the future)?** Yes — plainly and always.
  This is the field that decides EP feasibility; never soften it.
- **Expected salary:** monthly base in SGD from `profile.yml`
  (e.g. "S$20,000/month base"). If the form asks annual, annualise explicitly:
  monthly x 12, and note AWS/variable separately. Never enter a US-annual
  figure into an SGD-monthly field.
- **Notice period:** answer in the unit the form asks (weeks or months),
  matching the candidate's real availability. Singapore tech contracts commonly
  specify 1–3 months.
- **Current location / relocation:** state current location honestly and add
  "willing to relocate to Singapore" where the form allows free text.
- **"How did you hear about us?":** use the candidate's actual source. Never
  select LinkedIn unless it genuinely was the source.
- **Languages:** state plainly (e.g. "English (fluent)"). No CEFR-style scale
  is standard in Singapore — do not invent proficiency frameworks.
- **Cover letter:** business-English tone — direct, concrete, no flattery.
  Maximum 1 page, PDF matching the CV design, posting quotes mapped to proof
  points. Include it whenever the form allows.

## Output format

```
## Answers for [Company] -- [Role]

Base: Report #NNN | Score: X.X/5 | Archetype: [type] | Market: Singapore | EP: required

---

### 1. [Exact form question]
> [Ready-to-paste answer]

### 2. [Next question]
> [Answer]

...

---

Notes:
- [Role variations, observations, etc.]
- [Customization points the candidate should double-check]
```

## After applying (optional)

If the candidate confirms submission:
1. Update status to "Applied" with the canonical CLI: `node set-status.mjs <report#> Applied` (never hand-edit `applications.md`).
2. Update the report's Block H with the answers actually submitted.
3. Suggest next step: `/career-ops contacto` for hiring-manager outreach.
