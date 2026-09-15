# Mode: interview — Canonical interview domain

`interview` is interview preparation, not profile intake. Use `intake` or
`add` to build a profile or CV.

Every interview action begins by resolving the same canonical opportunity:

```bash
node interview-context.mjs <opportunity-id> --db "$CAREER_OPS_OPPORTUNITY_DB"
```

Its output is the only shared context: opportunity, evaluation/report
artifacts, candidate fact files, application state, and prior sessions.
Actions are bounded:

| Action | Output | Write boundary |
|---|---|---|
| `interview-prep` | company and role intelligence | role prep note only |
| `interview/plan` | time-boxed plan | none |
| `interview/practice` | one-question simulation | session record only |
| `interview/debrief` | learning review | session/question bank; story bank only with provenance rules |
| `interview-redflag` | evidence-tiered China/HK/applicable-remote review | red-flag note only |
| `weekly-digest` | derived session rollup | none |

Candidate facts remain `cv.md`, `article-digest.md`, `config/profile.yml`, and
`modes/_profile.md`. A session that lacks the canonical company and role is
out of scope for that opportunity.
