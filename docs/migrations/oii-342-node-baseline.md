<!-- Maps the effective Node CV-maintenance path to its Python LangGraph replacement. -->

# OII-342 Node CV-maintenance baseline

The source baseline is `cv-maintenance.mjs` plus the deterministic insertion
behavior it used from `add-entry.mjs` at `66f35982`. Both retired entrypoints
and their Node-only tests are removed after the Python replacement.

| Effective Node behavior | Python + LangGraph replacement |
|---|---|
| Accept one proposal or a non-empty proposal list | `workflow.cv_maintenance preview` |
| Require source, exact evidence, target, wording, deduplication and provenance fields | validation graph node |
| Detect numeric, scope and authorship claims declared by the proposal | deterministic trust-boundary validation |
| Verify primary source quotations before treating a proposal as verified | repository-root-bounded provenance lookup |
| Allow unverified non-claim material to be previewed but never applied | persisted `can_apply` gate |
| Preview CV/article changes without mutation | frozen preview, hashes and unified diffs in SQLite |
| Require the exact `approved` confirmation before writing | `apply <task-id> --confirm approved` |
| Deduplicate Unicode project names and article headings | normalized identifier equality |
| Keep `cv.md` as the one-way candidate-fact source | no resume import or external writeback |
| Avoid partial CV/article writes and duplicate confirmation | staged replacement, rollback and idempotent confirmation record |
| Recover the preview phases after interruption | task-scoped LangGraph SQLite checkpoint and `resume` |
