# Mode: batch — Mass Processing of Jobs

Two usage modes: **conductor --chrome** (navigates portals in real time) or **standalone** (script for URLs already collected).

## Architecture

```text
Claude Conductor (claude --chrome --dangerously-skip-permissions)
  │
  │  Chrome: navigates portals (logged-in sessions)
  │  Reads DOM directly — the user sees everything in real time
  │
  ├─ Job 1: reads JD from DOM + URL
  │    └─► claude -p worker → report .md + PDF + tracker-line
  │
  ├─ Job 2: click next, read JD + URL
  │    └─► claude -p worker → report .md + PDF + tracker-line
  │
  └─ End: merge tracker-additions → applications.md + summary
```

Each worker is a child `claude -p` with a clean 200K token context. The conductor only orchestrates.

## Files

```text
batch/
  batch-input.tsv               # URLs (from conductor or manual)
  batch-state.tsv               # Progress (auto-generated, gitignored)
  batch-runner.sh               # Standalone orchestrator script
  batch-prompt.md               # Prompt template for workers
  logs/                         # One log per job (gitignored)
  tracker-additions/            # Tracker lines (gitignored)
```

## Mode A: Conductor --chrome

1. **Read state**: `batch/batch-state.tsv` → identify what has already been processed
2. **Navigate portal**: Chrome → search URL
3. **Extract URLs**: Read results DOM → extract URL list → append to `batch-input.tsv`
4. **For each pending URL**:
   a. Chrome: click on the job → read JD text from the DOM
   b. Save JD to `/tmp/batch-jd-{id}.txt`
   c. Calculate next sequential REPORT_NUM
   d. Execute via Bash:

      ```bash
      claude -p --dangerously-skip-permissions \
        --append-system-prompt-file batch/batch-prompt.md \
        "Process this job. URL: {url}. JD: /tmp/batch-jd-{id}.txt. Report: {num}. ID: {id}"
      ```

   e. Update `batch-state.tsv` (completed/failed + score + report_num)
   f. Log to `logs/{report_num}-{id}.log`
   g. Chrome: go back → next job
5. **Pagination**: If no more jobs → click "Next" → repeat
6. **End**: Merge `tracker-additions/` → `applications.md` + summary

## Mode B: Standalone script

```bash
batch/batch-runner.sh [OPTIONS]
```

Options:
- `--dry-run` — list pending jobs without executing
- `--retry-failed` — retry only failed jobs
- `--start-from N` — start from ID N
- `--parallel N` — N workers in parallel
- `--max-retries N` — attempts per job (default: 2)

## batch-state.tsv Format

```text
id	url	status	started_at	completed_at	report_num	score	error	retries
1	https://...	completed	2026-...	2026-...	002	4.2	-	0
2	https://...	failed	2026-...	2026-...	-	-	Error msg	1
3	https://...	pending	-	-	-	-	-	0
```

## Resumability

- If it crashes → re-run → reads `batch-state.tsv` → skip completed jobs
- Lock file (`batch-runner.pid`) prevents double execution
- Each worker is independent: failure in job #47 does not affect the others

## Workers (claude -p)

Each worker receives `batch-prompt.md` as a system prompt. It is self-contained.

The worker produces:
1. `.md` report in `reports/`
2. PDF in `output/`
3. Tracker line in `batch/tracker-additions/{id}.tsv`
4. Result JSON via stdout

## Error handling

| Error | Recovery |
|-------|----------|
| URL inaccessible | Worker fails → conductor marks `failed`, continues |
| JD behind login | Conductor attempts to read DOM. If it fails → `failed` |
| Portal changes layout | Conductor reasons about HTML, adapts |
| Worker crashes | Conductor marks `failed`, continues. Retry with `--retry-failed` |
| Conductor crashes | Re-run → reads state → skip completed jobs |
| PDF fails | .md report is saved. PDF remains pending |
