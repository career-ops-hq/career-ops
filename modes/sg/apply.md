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

- **Work authorization / right to work:** read the candidate's Singapore work
  status from `config/profile.yml` (`sg.work_status`: `citizen` | `pr` |
  `pass-holder` | `foreign`). When the profile is silent, default to `foreign`
  ("Employment Pass sponsorship required. I am not currently authorized to
  work in Singapore.") and say so in the Notes. Never select or imply a
  status the profile does not support. If the form only offers "Are you
  authorized to work in Singapore? Yes/No" with no sponsorship nuance,
  answer from the profile status and add the sponsorship need in a free-text
  field.
- **Require sponsorship (now or in the future)?** Answer from the same
  profile status, never from a default the profile contradicts:
  `citizen` or `pr` → No. `pass-holder` → ask the candidate, because the
  answer depends on the pass they hold. `foreign`, or a silent profile → Yes,
  plainly: this is the field that decides EP feasibility; never soften it.
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

Follow `modes/apply.md`'s output format verbatim — `## Responses for
[Company] — [Role]`, the `Based on:` line, one `Length:` line per answer,
the trailing Notes — and add the Singapore header line:

```text
## Responses for [Company] — [Role]

Based on: Report #NNN | Score: X.X/5 | Archetype: [type] | Market: Singapore | EP: required / not required / refused | SG status: [from profile]

---

### 1. [Exact form question]
> [Response ready for copy-paste, or "Ask candidate: ..." if the field needs confirmation]
Length: [used/allowed characters or words, or "limit unknown"]

### 2. [Next question]
> [Response]
Length: [used/allowed characters or words, or "limit unknown"]

Repeat the response and length lines for every remaining question.

---

Notes:
- [SG work status used and its source: profile `sg.work_status` or defaulted to foreign]
- [Role variations, observations, etc.]
- [Customization points the candidate should double-check]
```

## Application Answers

Persist exactly as `modes/apply.md` specifies: after the final answers are
filled into the form or handed to the candidate for copy-paste, update the
matched report with an additive `## Application Answers` section (recovered
through the strict reader, never re-read as prose); on confirmed submission,
refresh it from `filled` to `submitted`.

## After applying (optional)

If the candidate confirms submission, follow `modes/apply.md` → Step 9
(Post-apply) as written: status via `set-status.mjs`, the follow-up seed via
`followup-seed.mjs`, the `## Application Answers` refresh to `submitted`, and
the `contacto` suggestion. Nothing Singapore-specific changes in that step.
