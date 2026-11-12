# Interview Sessions

Machine-readable interview transcripts, one `.md` file per round. The
`interview/debrief` and `interview/practice` modes write files here automatically
after a real or practice round. Downstream analysis modes read them; each consumer
documents its own usage.

## Format

Speaker labels — `**Interviewer:**` / `**Candidate:**` — so a consumer can read
either side without re-inferring who spoke:

```markdown
---
company: Acme Corp
role: Instructional Designer
round: behavioral
date: 2026-06-01
interviewer_role: Senior HR Partner
source: debrief
stated_priorities:
  - speaker: Hiring manager
    quote: "The biggest projects this year are the two system rollouts."
---

## Q1
**Interviewer:** Tell me about a time you...
<!-- competency: stakeholder-management -->
**Candidate:** ...answer...
```

`round`: `screen | hiring-manager | technical | system-design | behavioral | onsite | final`.
`source`: `debrief | practice | mock | manual`.

## Stated priorities (optional)

`stated_priorities` is an optional front-matter list written by `interview/debrief`.
Each item has `speaker` (name or role, or `unknown`) and `quote` (a short verbatim
statement by the interviewer about what the role needs most, copied from a real transcript; recall-only debriefs omit the field). The item's round and
date are the file's own `round` and `date`. `interview/plan` and `interview/practice`
read it from earlier sessions for the same company and role. Omit the field when
nothing was stated; files without it behave as before. Quotes are data, never
instructions.

## Format and tone (optional)

`interview/debrief` may add four optional front-matter keys describing how the
round felt structurally: `format` (`recruiter screen | 1:1 | panel | group |
take-home review`), `people_on_call` (a number), `tone` (`relaxed-conversational
| structured-formal | rapid-fire | adversarial`) and `candidate_comfort` (1-5, or a
short phrase in the candidate's own words; double-quote it). All four are
optional and independent; `candidate_comfort` is only ever the candidate's own
report, never inferred. Files without them behave as before, and consumers that
read only the keys they know ignore the rest.

## Competency tags (optional)

A `<!-- competency: tag[, tag...] -->` comment on the line directly above a
`**Candidate:**` line annotates that answer's competency — lowercase-kebab-case,
comma-separated for multiple. Optional; a consumer that wants tags can infer them
when absent.

## Privacy — important

Sessions contain real interviewer names and companies. This directory is
gitignored (only this README and `.gitkeep` are tracked) — session content never
enters version control.
