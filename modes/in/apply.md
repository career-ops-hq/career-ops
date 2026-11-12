# Mode: apply — Live Application Assistant (India market)

> Apply `voice-dna.md` (if present) to free-text answers and cover-letter fields — full guardrail, conversational voice included (Tier 1 + 2). See `_writing.md` → Voice DNA.

Interactive mode for when the candidate is filling out an application form for
an employer in India (the employer's own careers page or ATS, a campus hiring
portal, Naukri, LinkedIn). Reads what is on the screen, loads the previous
evaluation context, and generates personalized answers for each form question.

## Base workflow

Follow `modes/apply.md` verbatim, including its Scope section. Run
`node apply-scope.mjs root` and `node apply-scope.mjs launch-options`. Do not
read `DevToolsActivePort` or attach to an existing browser. Do not submit the
form. The steps below are India-specific field guidance for the GENERATE step;
the rules they cite are in `modes/in/_shared.md`.

## India-specific fields

- **Expected CTC:** the annual CTC target from `profile.yml`, labeled as CTC.
  When the field asks for lakh per annum, enter the figure in lakh. Never enter
  an in-hand figure unless the field asks for in-hand pay.
- **Current CTC:** the candidate's choice. Default to "Ask candidate: ..." and
  never write a figure the candidate has not given for this application
  (`_shared.md` rule 15). A fresher with no full-time job enters what the form
  allows for none (0 or "Fresher"), after asking.
- **Notice period / joining date:** the candidate's real notice period or the
  date they can join, from them or the profile. A student's joining date comes
  after final exams unless the candidate says otherwise. Never fill in a
  default.
- **Total and relevant experience:** counted from the dates in `cv.md`, in the
  units the form asks for (years and months). Internships count only when the
  field asks for them. Never round up.
- **Graduation year / batch:** exactly as `cv.md` states it.
- **CGPA or percentage, 10th and 12th marks:** exactly as `cv.md` states them.
  Never convert a CGPA to a percentage unless the candidate supplies the
  university's formula. When the CV does not state a figure, ask.
- **Active backlogs / gap years:** from the candidate only. Default to "Ask
  candidate: ...".
- **Preferred location / willing to relocate:** the cities and relocation
  answer in the profile only.
- **Aadhaar, PAN, bank, passport, UAN:** never fill these in. Leave the field
  for the candidate and say so in the Notes.
- **Date of birth, gender, marital status, category:** leave them for the
  candidate unless they supply them, and say so in the Notes.
- **"How did you hear about us?" / referral code:** the candidate's actual
  source. Never invent a referrer or select a source that was not the real one.
- **Bond or service-agreement acknowledgement:** never tick it. Quote the
  terms in the Notes and leave the decision to the candidate.
- **Cover letter:** one page, PDF matching the CV design, posting quotes
  mapped to proof points. Include it whenever the form allows.

## Output format

Follow `modes/apply.md`'s output format verbatim (`## Responses for
[Company] — [Role]`, the `Based on:` line, one `Length:` line per answer,
the trailing Notes) and add the Indian header fields:

```text
## Responses for [Company] — [Role]

Based on: Report #NNN | Score: X.X/5 | Archetype: [type] | Market: India | Career stage: [fresher or experienced]
[On **Draft without saving**, drop the report number, score and archetype from the line above and open it with "No report: drafted for this posting, not saved"; keep the Indian fields]

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
- [CTC basis used and its source in profile.yml]
- [Fields left for the candidate (ID numbers, personal fields, bond acknowledgements), and why]
- [Customization points the candidate should double-check]
```

## Application Answers

Persist exactly as `modes/apply.md` specifies, including its check that the
form is still the report's posting (Step 8 →
"Write only to the report of this posting"): after the final answers are filled into the form or handed to the
candidate for copy-paste, update the matched report with an additive
`## Application Answers` section (recovered through the strict reader, never
re-read as prose); on confirmed submission, refresh it from `filled` to
`submitted`.

## After applying (optional)

If the candidate confirms submission, follow `modes/apply.md` → Step 9
(Post-apply) as written: status via `set-status.mjs`, the follow-up seed via
`followup-seed.mjs`, the `## Application Answers` refresh to `submitted`, and
the `contacto` suggestion. Nothing India-specific changes in that step.
