---
name: career-ops
description: Personal job-search workflow.
arguments: mode
user-invocable: true
---

# Career-ops router

Read `prompts/shared/contract.md`, resolve `language.output` from
`config/profile.yml`, then read the domain prompt and inputs named in
`prompts/CONTEXT_MANIFEST.md`. The manifest is the complete context contract.

Route `scan`, `discover`, `pipeline`, a pasted JD/URL, `oferta`, `evaluate`, and
`shortlist`, `batch`, `ofertas`, `deep`, `triage`, `eu-swe`, and `eu-fintech`
to evaluation; `apply`, `pdf`, `latex`, `latex-tex`, `cover`, `email`, and
`contacto` to applications; all `interview*` commands to interviews; `add`,
`expand`, and `intake` to CV; and `tracker`, `followup`, `reply-watch`,
`outcome`, `offer-prep`, `patterns`, `titles`, `upskill`, `training`, and
`project`, `agent-inbox`, `inbox`, and `update` to insights.

Use the employment rule for Mainland China, Hong Kong, or remote work that
matches the opportunity. It supplies employment policy only; output language
always follows `language.output`.

For a missing/unknown command, show the available commands and ask for the
user's intended workflow. Existing runtime commands and validators remain the
source of executable behavior until their owning migration issues replace them.
