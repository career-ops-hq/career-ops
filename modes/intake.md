# Mode: intake — Multi-Source Profile Intake

## Purpose

A thin profile produces a generic tailored CV. This mode populates
`config/profile.yml` / `cv.md` / `modes/_profile.md` from the documents the
user already has — master CV, LinkedIn "Save to PDF" export, transcripts,
reference letters — instead of asking them to fill everything in by hand
(#1723).

Pattern credit: [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search)'s
`documents/` intake + idempotent `/setup` merge, adapted to career-ops'
user-layer contract.

Division of labor: `intake.mjs` does everything deterministic (enumerate
`documents/`, extract text locally, fingerprint sources so re-runs surface
only new material). This mode does the semantic mapping and the
human-in-the-loop gate. **Nothing is written without an explicit user
confirm.**

## Inputs

- `documents/` — intake folder (user layer, gitignored): `cv/`, `linkedin/`,
  `diplomas/`, `references/`
- `config/profile.yml`, `cv.md`, `modes/_profile.md` — merge targets
- `data/intake-state.json` — fingerprints of already-ingested sources
  (written by `intake.mjs --commit`, user layer)

## Step 1 — Scan and extract

```bash
node intake.mjs            # JSON: per-source status + preview
```

- If `pdfExtractor` is `null` and there are PDF sources, relay the `pdfHint`
  (optional poppler install) and continue with whatever extracted.
- Sources with `status: "skipped"` (images, `.docx`, scanned PDFs with no
  text layer): tell the user which files and why, and ask them to convert.
  Do NOT attempt OCR — out of scope for v1.
- Sources with `status: "ingested"` are already merged — **do not
  re-propose them.** Only `new` and `changed` sources carry new material.

## Step 2 — Read the full text of each new source

```bash
node intake.mjs --text <path-relative-to-documents/>
```

## Step 3 — Map to proposals (read-before-write)

Read the current `config/profile.yml`, `cv.md`, and `modes/_profile.md`
FIRST. Then, per source type:

- **CV** → experience entries, education, skills
- **LinkedIn export** → certifications, endorsements, volunteer work,
  about-summary
- **diplomas/transcripts** → verified degree names, dates, coursework
- **references** → referee quotes, competency language

Rules (non-negotiable):

- Extract facts only — reformulate wording, **never fabricate** skills,
  titles, dates, or achievements that the source doesn't state.
- Every proposed addition is **source-annotated**: note which document it
  came from (e.g. `# source: documents/diplomas/msc-transcript.pdf`).
- **Never silently overwrite.** If a proposal conflicts with an existing
  value (different job title for the same period, different degree date),
  show both side by side and let the user pick.
- Additions only go to fields that are empty or explicitly confirmed for
  replacement.

## Step 4 — Present and confirm

Show one consolidated proposal table: target file → field → proposed value
→ source. Wait for the user's explicit confirmation (all / per-item).
**STOP here if the user doesn't confirm — do not write.**

## Step 5 — Write and record

1. Apply the confirmed edits to `config/profile.yml` / `cv.md` /
   `modes/_profile.md` directly (agent edit — these files are user layer;
   no script writes them).
2. Record **only the sources that were actually merged**, so the next run
   proposes only new material:

```bash
node intake.mjs --commit <path> [<path> …]   # the confirmed sources
node intake.mjs --commit                     # only if ALL were merged
```

   Never blanket-commit after a partial confirmation — a declined source
   must stay `new` so it is re-proposed next time.

3. Verify: `node doctor.mjs` should report the profile prerequisites
   satisfied.

## Out of scope (v1)

- OCR for scanned/image-only PDFs (explicit later opt-in — see #1723).
- `.docx` / images: ask the user to convert.
- Auto-writing any user-layer file without the Step 4 confirm.
