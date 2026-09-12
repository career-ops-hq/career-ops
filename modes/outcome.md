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
node outcome.mjs <report#|company> <outcome_type> [--stage "..."] [--feedback "..."] [--note "..."] [--role "..."] [--clean-output]
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
- `--clean-output`: Once the tailored CV is archived, remove its generated PDF/HTML from `output/` (see below)
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

## `output/` Cleanup (`--clean-output`, opt-in, #2653)

`output/` accumulates the tailored PDF/HTML generated at evaluation time for every application, including ones that have since concluded. Passing `--clean-output` removes the tailored PDF/HTML for *this* row from `output/` once its outcome has been recorded — but only after the archive is verified, never as a bare delete:

1. Archives the CV PDF to `submitted_cv.pdf` (already happens by default) and, only when `--clean-output` is set, the companion HTML to `submitted_cv.html`.
2. Verifies each archived copy exists in `data/outcomes/{num}_{company_slug}_{role_slug}/` and matches the `output/` original **byte-for-byte (sha256)** — a size check alone can't tell two same-length renders apart, so this hashes both files the same way `tracker.mjs` and `seed-fixture.mjs` already do.
3. Only then deletes the `output/` original. If verification fails or the archived copy is missing, the `output/` file is left in place and reported as refused — never deleted on an unverified archive.
4. `--dry-run --clean-output` lists the exact files that would be archived-then-removed without touching anything.

**Permanently opt-in, not a default-on candidate.** `output/*` is user layer (`DATA_CONTRACT.md`) — the system never deletes it unless explicitly asked, every single time. This is deliberate: `outcome.mjs` deletes nothing without `--clean-output`, and a `--no-clean-output` escape hatch would not help, since whoever needed it would only find out after the file was already gone.

**Eligibility is the `output/` boundary, not which flag resolved the path.** A PDF is a cleanup candidate whenever it resolves *inside* `output/` — whether `outcome.mjs` auto-detected it from the tracker's PDF column, from `data/pdf-index.tsv`, or the user pointed at it explicitly with `--cv`. An explicit `--cv` pointing anywhere *outside* `output/` (e.g. a path in the user's home directory) is never touched — `--cv` accepts any path, so without that boundary the blast radius would stop being "the output directory" and become "wherever the user pointed." The `cv.md` fallback (no PDF resolved at all) is likewise never eligible.

The containment check itself uses `path.relative()` plus Node's own `path.isAbsolute()` (platform-independent — works the same on POSIX and Windows separators, including Windows drive-absolute and UNC paths) rather than a hand-rolled string-prefix comparison, and it is applied separately to **both** the PDF and its manifest-sourced HTML companion. `data/pdf-index.tsv` is host-writable data, not a trusted boundary in itself — a malformed or manipulated `html` column is never treated as inside `output/` just because its paired PDF is; each path is checked independently before either can become a deletion candidate.
