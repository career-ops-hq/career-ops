# Architecture

This file describes the runtime flows. Design principles and the
system/user data-contract layers live in [../ARCHITECTURE.md](../ARCHITECTURE.md).

## System Overview

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="architecture-system-overview-dark.svg"><img src="architecture-system-overview-light.svg" alt="System overview: an AI coding CLI agent reads AGENTS.md and modes/*.md and runs one of three flows. Single evaluation (modes/auto-pipeline.md) goes straight to output. Portal scan (scan.mjs and modes/scan.md) fills the URL inbox, data/pipeline.md, which pipeline mode then evaluates. Batch processing (batch/batch-runner.sh) runs N headless workers, one per offer: claude -p workers run in parallel, other CLIs one offer at a time. All three feed the output pipeline: a report (reports/NNN-*.md, the A-H evaluation), a PDF (generate-pdf.mjs, HTML through Playwright) and a tracker TSV (batch/tracker-additions/, merged by merge-tracker.mjs) into the canonical tracker, data/applications.md." width="760"></picture></p>

## Evaluation Flow (Single Offer)

1. **Input**: User pastes JD text or URL
2. **Extract**: Playwright/WebFetch extracts JD from URL
3. **Classify**: Detect archetype (1 of 6 types)
4. **Evaluate**: 8 blocks (A-H; H is conditional on scores ≥ 4.5):
   - A: Role summary
   - B: CV match (per-requirement importance + gaps + mitigation)
   - C: Level strategy
   - D: Comp research (WebSearch)
   - E: CV personalization plan
   - F: Interview prep (STAR stories)
   - G: Posting legitimacy (scam / ghost-job signals)
   - H: Draft application answers (only when the score is 4.5 or above)
5. **Score**: One global score (1-5), a holistic judgment across 5 dimensions
   with no arithmetic formula; blocks A-H are not averaged (`modes/_shared.md` → Scoring System)
6. **Report**: Save as `reports/{num}-{company}-{date}.md`
7. **PDF**: Generate ATS-optimized CV (`generate-pdf.mjs`)
8. **Track**: New entries via TSV in `batch/tracker-additions/` merged by
   `merge-tracker.mjs`; status updates to existing rows via `set-status.mjs`

## Batch Processing

The batch system processes multiple offers in parallel:

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="architecture-batch-processing-dark.svg"><img src="architecture-batch-processing-light.svg" alt="Batch processing: batch/batch-input.tsv lists the offers (id, url, source, notes). The orchestrator, batch/batch-runner.sh, records progress in batch/batch-state.tsv so a run can retry and resume, and hands each offer to one of N headless CLI workers running the self-contained prompt batch/batch-prompt.md. Workers are claude -p by default and run in parallel (--parallel, default 3); any other CLI runs one offer at a time. Each worker writes a report (reports/NNN-*.md), a PDF (output/*.pdf) and a tracker TSV line (batch/tracker-additions/). After the batch, merge-tracker.mjs merges the TSV lines into the canonical tracker, data/applications.md." width="760"></picture></p>

Each worker is a headless AI CLI instance. The bundled `batch-runner.sh` runs `claude -p` workers by default; `--cli opencode`, `--cli gemini`, `--cli qwen` or `--cli grok` selects another CLI. Only `claude` workers run in parallel (`--parallel`, default 3) and retry on rate limits; the other CLIs run one offer at a time, with a single attempt per run (a later run still retries a failed offer, up to `--max-retries`). The Headless / Batch Mode table in `AGENTS.md` is not the runner's `--cli` list: it includes CLIs the runner does not launch, and it has no Gemini row because Gemini CLI is now a legacy wrapper (see `docs/SUPPORTED_CLIS.md`). Workers produce:
- Report .md
- PDF
- Tracker TSV line

The orchestrator manages parallelism, state, retries, and resume.

## Data Flow

```
cv.md                    →  Evaluation context
article-digest.md        →  Proof points for matching
config/profile.yml       →  Candidate identity
portals.yml              →  Scanner configuration
templates/states.yml     →  Canonical status values
templates/cv-template.html → PDF generation template
```

## File Naming Conventions

- Reports: `{###}-{company-slug}-{YYYY-MM-DD}.md` (3-digit zero-padded)
- PDFs: `cv-candidate-{report-num}-{company-slug}-{YYYY-MM-DD}.pdf`
- Tracker TSVs: `batch/tracker-additions/{id}.tsv`

## Pipeline Integrity

Scripts maintain data consistency:

| Script | Purpose |
|--------|---------|
| `merge-tracker.mjs` | Merges batch TSV additions into applications.md |
| `verify-pipeline.mjs` | Health check: statuses, duplicates, links |
| `dedup-tracker.mjs` | Removes duplicate entries by company+role |
| `normalize-statuses.mjs` | Maps status aliases to canonical values |
| `fix-report-links.mjs` | Rewrites Report cells that link to a missing file to `—` (previewable, backed up) |
| `cv-sync-check.mjs` | Validates setup consistency |

## Dashboard TUI

The `dashboard/` directory contains a standalone Go TUI application that visualizes the pipeline:

- Filter tabs: All, Evaluated, Interview, Assessment, Responded, Applied, Top ≥4, Skip, Rejected, Discarded
- Sort modes: Score, Date, Company, Status, Location, Pay, Last contact, Posted
- Grouped/flat view
- Lazy-loaded report previews
- Inline status picker
