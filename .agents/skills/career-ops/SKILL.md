---
name: career-ops
description: Personal job-search workflow.
arguments: mode
user-invocable: true
---

# Career Ops router

Read `prompts/shared/contract.md`, resolve `language.output` from
`config/profile.yml`, then load the matching row from
`prompts/CONTEXT_MANIFEST.md`.

- Discovery, evaluation, and shortlist requests use `evaluation`.
- Drafting an application uses `applications`; never submit or send it.
- Interview preparation uses `interviews`.
- CV maintenance uses `cv` and requires confirmation before changing facts.
- Tracker and retained evidence queries use `insights`.

Use the applicable Mainland China, Hong Kong, or remote employment rule. It
supplies policy only; all prose follows `language.output`.

Persist scan, score, and apply through `workflow/career_ops.py`. Hermes may run
the repository cron scripts, but it never decides or advances workflow state.
