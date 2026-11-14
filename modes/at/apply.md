# Mode: apply — Live Application Assistant (Austria market)

> Apply `voice-dna.md` (if present) to free-text answers and cover-letter fields — full guardrail, conversational voice included (Tier 1 + 2). See `_writing.md` → Voice DNA.

Interactive mode for when the candidate is filling out an application form for
an employer in Austria (the employer's own careers page or ATS, karriere.at,
StepStone, LinkedIn). Reads what is on the screen, loads the previous
evaluation context, and generates personalized answers for each form question.

## Base workflow

Follow `modes/apply.md` verbatim, including its Scope section. Run
`node apply-scope.mjs root` and `node apply-scope.mjs launch-options`. Do not
read `DevToolsActivePort` or attach to an existing browser. Do not submit the
form. The steps below are Austria-specific field guidance for the GENERATE step;
the rules they cite are in `modes/at/_shared.md`.

## Austria-specific fields

- **Gehaltsvorstellung / expected salary:** annual gross from `profile.yml`,
  labelled as annual gross including the 13th and 14th salary. If the field
  asks for a monthly figure, enter the monthly gross and add "× 14" where the
  form allows free text. Never enter a net figure unless the field asks for
  net, and never a figure below the posting's own stated minimum without
  asking the candidate (it usually means a unit mismatch).
- **Aktuelles Gehalt / current salary:** the candidate's choice. Default to
  "Ask candidate: ..." and suggest answering with the expected salary instead.
  Never invent a current salary.
- **Kündigungsfrist / notice period:** the candidate's real notice period,
  from them or their contract. Never fill in the statutory default.
- **Frühestmöglicher Eintritt / earliest start date:** derive it from the
  candidate's notice period only when they have given it; otherwise ask.
- **Arbeitserlaubnis / right to work:** from the profile only. An EU/EEA/Swiss
  citizen needs no permit; never state a citizenship or permit the profile
  does not state. If the form only offers Yes/No, answer from the profile and
  put any permit need in a free-text field.
- **Titel / academic title:** exactly as `cv.md` states it. Leave the field
  empty when `cv.md` has none.
- **Geburtsdatum, Familienstand, Foto / date of birth, marital status, photo:**
  optional in Austria. Leave them empty unless the candidate supplies them or
  the profile enables a photo, and say so in the Notes.
- **Zeugnisse / certificates and references:** upload only what the candidate
  provides; otherwise "available on request".
- **Sprachkenntnisse / languages:** CEFR levels (A1-C2) from `cv.md` or the
  profile. Never inflate a level.
- **"Wie sind Sie auf uns aufmerksam geworden?" / "How did you hear about
  us?":** the candidate's actual source. Never select LinkedIn or karriere.at
  unless it genuinely was the source.
- **Cover letter / Motivationsschreiben:** one page, PDF matching the CV
  design, posting quotes mapped to proof points. In German, formal "Sie".
  Include it whenever the form allows.

## Output format

Follow `modes/apply.md`'s output format verbatim — `## Responses for
[Company] — [Role]`, the `Based on:` line, one `Length:` line per answer,
the trailing Notes — and add the Austrian header fields:

```text
## Responses for [Company] — [Role]

Based on: Report #NNN | Score: X.X/5 | Archetype: [type] | Market: Austria | Salary basis: [annual gross incl. Sonderzahlungen or monthly × 14]
[On **Draft without saving**, drop the report number, score and archetype from the line above and open it with "No report: drafted for this posting, not saved"; keep the Austrian fields]

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
- [Salary basis used and its source in profile.yml]
- [Optional fields left empty, and why]
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
the `contacto` suggestion. Nothing Austria-specific changes in that step.
