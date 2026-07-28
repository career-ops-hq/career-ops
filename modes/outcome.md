# Mode: outcome — Record Application Outcome & Archive Artifacts

## Purpose

Record the outcome of an application conversationally, archive per-application artifacts (submitted CV, cover letter, job posting snapshot or explicit stub file, and outcome log), and synchronize status in `data/applications.md` idempotently.

**Phase 1 MVP Scope:**
- Records outcomes conversationally
- Archives artifacts in `data/outcomes/{num}_{company_slug}_{role_slug}/`
- Synchronizes status via `node set-status.mjs`
- Append-only outcome logging (never rewrites history)
- Strictly verbatim feedback recording (never fabricates unstated facts or paraphrases candidate statements)

**Not in scope for Phase 1:**
- Scoring model changes, fit grading modifications, A–F calibration, STAR story mining, or automated feedback interpretation.

## Inputs

- `data/applications.md` — Application tracker
- `cv.md` — Active CV (submitted CV snapshot)
- `templates/states.yml` — Canonical tracker states
- User input — Selector (report # or company name), outcome type, stage reached, verbatim feedback, notes

## Supported Outcomes & Tracker Mapping

| User Outcome | Canonical Tracker State | Default Note |
|--------------|-------------------------|--------------|
| `interview progress` / `stage reached` | `Interview` | Stage update |
| `offer received` | `Offer` | Offer received |
| `hired` | `Hired` | Offer accepted |
| `offer_declined` | `Discarded` | Offer declined by candidate |
| `rejected` | `Rejected` | Application rejected |
| `no_response` | `Discarded` | No response / ghosted |
| `interview_only` | `Interview` (or `Discarded`/`Rejected` if process concluded) | Interview process completed |

## Execution Procedure

Run the helper script:

```bash
node outcome.mjs <report#|company> <outcome_type> [--stage "..."] [--feedback "..."] [--note "..."] [--role "..."]
```

### Script CLI Options

- `<report#|company>`: Application selector (# or company name)
- `<outcome_type>`: `interview_progress` | `offer_received` | `hired` | `offer_declined` | `rejected` | `no_response` | `interview_only`
- `--stage "..."`: Specific interview stage reached (e.g. "Tech Screen", "System Design", "Final Round")
- `--feedback "..."`: Verbatim feedback from recruiter or interviewer (never paraphrased)
- `--note "..."`: Note to append to tracker row in `data/applications.md`
- `--role "..."`: Disambiguate when multiple applications share the same company
- `--cv "..."`: Custom CV file path (defaults to `cv.md`)
- `--cover "..."`: Custom cover letter file path (if available)
- `--url "..."`: Job posting URL (overrides auto-detection from tracker notes)
- `--dry-run`: Preview outcome logging steps and tracker updates without writing files
- `--json`: Format the stdout output as machine-readable JSON

## Archived Artifacts

Each invocation creates or appends to `data/outcomes/{num}_{company_slug}_{role_slug}/`:

1. `submitted_cv.md` — Snapshot of CV at application/outcome time
2. `submitted_cover_letter.md` — Snapshot of cover letter (if provided)
3. `posting.pdf` — Job posting PDF snapshot via `archive-posting.mjs` (or `posting_missing.md` stub if unavailable)
4. `outcome.md` — Append-only outcome journal logging date, status transition, stage, verbatim feedback, and notes

## Rules & Constraints

1. **Verbatim Feedback:** Record feedback *exactly* as stated by candidate or recruiter. Never manufacture, infer, or embellish reasons.
2. **Append-Only History:** `outcome.md` and tracker notes are strictly append-only. Re-running for an updated stage adds a new entry section without modifying previous logs.
3. **Idempotency:** Re-running the same command with identical arguments produces clean, duplicate-safe output and safe tracker updates.
4. **Posting Archiving Stub:** If the live job posting URL cannot be reached or is un-archivable, an explicit stub `posting_missing.md` is created documenting the attempt.
