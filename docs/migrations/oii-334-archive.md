<!-- Records the verified OII-334 cutover archive and paused scheduler state. -->

# OII-334 archive record

- Archive: `/Users/oii/dev/career-ops-archives/20260920T112743+0800`
- Career Ops cron jobs paused at `2026-09-20T11:27:43+08:00`:
  - `504a0b3c252c` — `career-ops scan（发现）` — previously active
  - `9ff33a7a6d12` — `career-ops score（评分）` — previously active
- No matching Career Ops worker process remained after pause. The scan execution
  ledger marks earlier runs `unknown` because their scheduler owner exited before
  recording a durable terminal state; this is retained as uncertainty, not
  reported as successful completion.
- Repository archive contains 8,326 files (241 MB together with Hermes records):
  historical business databases, source/JD captures, reports, application
  materials, score run checkpoints, caches, and legacy tracker files.
- Hermes archive contains the two job definitions, 71 job output files, four
  score research request dumps, and consistent snapshots of the shared execution
  and notepad databases. Shared Hermes databases and paused job definitions remain
  in place because removing them would affect other projects or prevent exact
  restoration.
- `SHA256SUMS.absolute` records every archived payload file. Checksum comparison of all
  non-database repository files produced no content differences before removal.
- SQLite `PRAGMA integrity_check` returned `ok` for both repository databases and
  both Hermes snapshots. Source/archive row counts matched: 312 opportunities,
  48 artifacts, zero workflow checkpoints, and zero legacy applications.
- Active `data/`, `reports/`, `output/`, and `jds/` now contain only tracked
  structural placeholders. New workflow code must not read the archive.
- Candidate facts, profiles, rules, prompts, source code, and necessary runtime
  configuration were retained in the active repository.

The two Career Ops jobs must remain paused until OII-338 accepts the integrated
workflow and explicitly restores only jobs that were active above and remain
applicable.
