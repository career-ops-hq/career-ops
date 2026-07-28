# Mode: ats -- ATS-Friendliness Check

## Purpose

career-ops already *generates* ATS-optimized CVs (see `modes/pdf.md`) and guards *what* they claim (`verify-cv-facts.mjs`). This mode answers the other half of the question users keep asking: **"is my CV actually ATS-friendly?"** — i.e. will an Applicant Tracking System's parser read it correctly at all.

`verify-ats.mjs` is a **deterministic, read-only** checker (no LLM, no network, no writes). It reads a generated CV's HTML — the output of `pdf` mode, before PDF rendering — and reports an **ATS-friendliness score (0-100 + letter grade)** plus a list of concrete, fixable issues. Think `verify-cv-facts.mjs`, but for structure and parseability instead of facts. It is **advisory**: it is not wired into the `pdf` pipeline and never blocks CV generation.

## Inputs

- A generated CV HTML file (e.g. `output/cv-{candidate}-{company}.html`).
- Optional target keywords (`--keywords` / `--role`) for an advisory keyword-coverage read.

## Usage

```bash
node verify-ats.mjs output/cv-jane-smith-acme.html
node verify-ats.mjs output/cv-jane-smith-acme.html --keywords "python,kubernetes,rag"
node verify-ats.mjs output/cv-jane-smith-acme.html --role "Senior Backend Engineer"
node verify-ats.mjs output/cv-jane-smith-acme.html --min-score 80 --json
```

Flags:

- `--keywords "a,b,c"` — comma-separated target keywords; reports coverage vs the CV text.
- `--role "..."` — a role title added to the keyword set as a single phrase (split only on commas, slashes, and the word "and"), matched verbatim against the CV text; it is not tokenized into individual words.
- `--min-score N` — pass threshold (default `70`, range 0-100).
- `--json` — machine-readable result on stdout (printed on both pass and fail).
- `--self-test` — run the built-in regression suite.
- `--help` — usage.

**Exit code:** `0` when the structural score is at or above `--min-score` **and** no `critical` issue is present; `1` otherwise — the same 0/1 contract as the other verifiers.

## What it checks (structural score, sums to 100)

Each check contributes a fixed weight; every deduction attaches a `critical`, `warning`, or `info` issue explaining what to fix.

| Weight | Check | Why it matters |
|--------|-------|----------------|
| 15 | Real, selectable text present (>= 300 chars) | An image-only / rasterized CV has no text layer for the ATS to read. |
| 20 | Standard section headings (Experience, Education, Skills required; Summary/Projects/Certifications bonus) | ATS parsers key off recognizable headings to segment the CV. |
| 15 | Contact email reachable in the body (phone presence checked, but not its placement) | ATS routinely drop semantic `<header>`/`<footer>` regions; the email must sit in the main body. (A plain `<div class="header">` title block, as in the shipped template, is body content and is not flagged.) |
| 20 | Single-column, no layout tables / multi-column CSS | Tables and columns scramble the reading order extractors follow. |
| 10 | No CV text baked into images | ATS cannot read text inside images. |
| 10 | Standard, embeddable fonts | Exotic fonts can extract as garbled or missing glyphs. |
| 5 | UTF-8 declared | Keeps accented characters and symbols intact through extraction. |
| 5 | No hidden text / keyword stuffing | Hidden white-on-white or `display:none` keywords are penalised. |

Grade: `A` >= 90, `B` >= 80, `C` >= 70, `D` >= 60, else `F`.

A single `display:table` element (as used by the shipped template's certifications block) does **not** reorder content and is intentionally not flagged — only real `<table>` elements and multi-column CSS are.

## Keyword coverage (opt-in, advisory)

When `--keywords` or `--role` is supplied, the checker reports how many target keywords appear in the CV text and which are missing. This is **advisory only**: it never changes the 0-100 structural score, so a run without a role never produces a false failure.

## Suggested workflow

1. Generate a CV via `pdf` mode (through the fact gate).
2. Run `node verify-ats.mjs output/cv-{candidate}-{company}.html`.
3. Fix any `critical`/`warning` items (usually in the template or the render payload), then re-run.
4. Optionally pass the JD's keywords with `--keywords` to confirm coverage before rendering the PDF.
5. Relay the result to the user: `[Render in {language.output}: the score and grade, then each issue's meaning and how to fix it, and the keyword-coverage line if present]`.

## Rules

- **Read-only.** The checker reads one HTML file and writes nothing; it never touches user-layer files (respects `DATA_CONTRACT.md`).
- **Advisory, not a gate.** Unlike `verify-cv-facts.mjs`, this is not part of the `pdf` hard-gate chain. Surface the score and issues to the user; do not block generation on it.
- **Deterministic.** Same HTML in, same score out — no model calls, no network.
- **Localize at the presentation boundary.** `verify-ats.mjs` emits fixed English by design (zero-LLM). When you relay its score and issues to the user, render the human-facing summary in `{language.output}` per AGENTS.md § "Output Language vs Market Modes" using the `[Render in {language.output}: …]` mechanism. Keep the checker's raw stdout English; only the surfaced summary is translated.
- Issues describe structural risk, not facts. For fact/fabrication guarding, use `verify-cv-facts.mjs`.
