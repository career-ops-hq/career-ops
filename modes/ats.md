# Mode: ats -- ATS-Friendliness Check

## Purpose

career-ops already *generates* ATS-optimized CVs (see `modes/pdf.md`) and guards *what* they claim (`verify-cv-facts.mjs`). This mode answers the other half of the question users keep asking: **"is my CV actually ATS-friendly?"** — i.e. will an Applicant Tracking System's parser read it correctly at all.

`verify-ats.mjs` is a **deterministic, read-only** checker (no LLM, no network, no writes). It reads a generated CV's HTML — the output of `pdf` mode, before PDF rendering — and reports an **ATS-friendliness score (0-100 + letter grade)** plus a list of concrete, fixable issues. Think `verify-cv-facts.mjs`, but for structure and parseability instead of facts. It is **advisory**: it is not wired into the `pdf` pipeline and never blocks CV generation.

The mode has **two stages**, because ATS parseability is decided in two places:

| Stage | Tool | Operates on |
|-------|------|-------------|
| Before the HTML exists | `ats-payload.mjs` | the render **payload** — one safe transform, three lints |
| After the HTML exists | `verify-ats.mjs` | the generated **HTML** — score, grade, issues |

**The score cannot tell you whether the payload stage was needed.** `verify-ats.mjs` reads the document it is given and judges its structure; a payload-level problem produces a structurally perfect document that still parses wrong. A CV whose competencies ship as CSS-separated tags under a header parsers do not recognise scores **97/A with zero issues** — identical to the same CV after the transform. Run the payload stage because the score cannot see it, not because the score complained.

## Inputs

- For the payload stage: a `build-cv-html.mjs` render payload (the compact JSON the `pdf` mode writes — see `modes/pdf.md` § "JSON Input Schema").
- For the HTML stage: a generated CV HTML file (e.g. `output/cv-{candidate}-{company}.html`).
- Optional target keywords (`--keywords` / `--role`) for an advisory keyword-coverage read.

## Payload preparation (`ats-payload.mjs`)

A template owns the DOM; it does not own what is in the payload, and some of what an ATS parser mishandles is in the payload. By the time a template sees `competencies: [...]` the decision that breaks parsing has already been made — so no template swap can fix it, and the HTML-stage score cannot see it.

`ats-payload.mjs` is **zero-LLM, deterministic, offline and read-only** with respect to user-layer files: payload JSON in, payload JSON out on stdout, findings on stderr. It never writes back to `cv.md` or `config/profile.yml`.

```bash
node ats-payload.mjs payload.json > payload-ats.json
node ats-payload.mjs payload.json --summary > payload-ats.json   # human findings on stderr
cat payload.json | node ats-payload.mjs - > payload-ats.json
```

**stdout is the payload and only the payload** — every human-facing word goes to stderr (JSON by default, a formatted report with `--summary`). That is what makes `> payload-ats.json` safe and lets it compose into a pipe.

Flags: `--summary` (human findings on stderr) · `--self-test` · `--help` / `-h`. A bare `-` reads the payload from stdin.

**Exit code:** `0` whenever the transform succeeded, findings or not — the lints are advisory and the payload on stdout is always usable. `1` only for an unreadable or malformed input, and in that case **nothing reaches stdout**, so a shell redirect cannot capture a half-right artifact.

### One transform (applied)

`competencies[]` is folded into `skills[]` as one comma-delimited category, and the source array is emptied.

`build-cv-html.mjs` renders competencies as bare tag spans into a container whose separation is entirely visual (`.competencies-grid { gap: 8px }`) — there is no delimiter *character* between one competency and the next, so the text layer runs adjacent items together into a single token. This is the class `modes/pdf.md` § "ATS Rules (clean parsing)" describes as outside a template lint's reach — nothing about the *rendered text layer* is visible in the HTML, so a clean lint and a clean score are both compatible with it — and it was reproduced with `pypdf` against a rendered PDF in #3251. The block also ships under `Core Competencies`, which parsers do not recognise as a section name, so it is frequently dropped whole rather than merely mangled. `Skills` **is** recognised, and already renders as `Category: a, b, c`. The same facts, expressed two ways, survive or don't depending on which array they sit in.

Pure data movement: nothing invented, reversible, and **idempotent** — a second run is a no-op, and re-added competencies merge into the existing category rather than duplicating it. A payload carrying a localized `sections.competencies` keeps its own label as the category name.

### Three lints (reported, never applied)

Each needs a decision only the user can make, which is where the no-fabrication rule in `AGENTS.md` draws the line. **Surface them; never act on them yourself.**

| Code | What it sees | Why the agent must not fix it |
|------|--------------|-------------------------------|
| `employer-in-role` | An employer name inside `experience[].role` — the trap for consulting and agency work, where a client's name reads naturally as part of the title. Yields a phantom employer in the parsed record | Deciding "this substring is an employer" is not something a script *or an agent* should be confident about, and silently rewriting a job title is worse than the mangling it prevents |
| `parenthetical-in-company` | `Globex (Cloud Platform Division)` — kept verbatim as part of the employer name, so the record matches no search for the employer | Stripping it is easy; deciding where that detail *goes* instead (role, location, a bullet) is authoring |
| `multiple-date-ranges` | Two date ranges in one `experience[].dates` — two stints at one employer parse as one | Splitting them needs someone to decide which bullets belong to which stint. The tool can see the second range; it cannot allocate the bullets |

A finding is a question for the user, not a task for you. Relay it, and if the user decides on a rewrite, the edit goes to the user-layer file it belongs in (`cv.md` / `config/profile.yml`) through the normal confirm-before-write path — never silently into the payload.

### Refused payload shapes

The payload is shape-checked before anything is transformed or reported, and a shape that would make the run quietly wrong is refused rather than accommodated: a non-array `skills` (folding into it would discard the value), a non-array `experience` (the lints would report nothing, reading exactly like a clean payload), a `competencies` member with no scalar value, or an `items` on the merged-into category that is neither a string nor an array. If a run exits 1, relay the message — it names the field and why.

## Usage (HTML stage)

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

The two stages chain in payload → HTML order, because the payload stage changes what the HTML stage will read:

1. Tailor the render payload as usual in `pdf` mode (through the fact gate).
2. **Payload stage:** `node ats-payload.mjs payload.json --summary > payload-ats.json`. The fold is applied for you; the three lints are findings to relay, not edits to make.
3. Build from the transformed payload: `node build-cv-html.mjs payload-ats.json output/cv-{candidate}-{company}.html [template]`.
4. **HTML stage:** `node verify-ats.mjs output/cv-{candidate}-{company}.html`.
5. Fix any `critical`/`warning` items (usually in the template), then re-run step 4.
6. Optionally pass the JD's keywords with `--keywords` to confirm coverage before rendering the PDF.
7. Relay both results to the user: `[Render in {language.output}: the fold that was applied and each lint finding with the decision it needs, then the score and grade, each issue's meaning and how to fix it, and the keyword-coverage line if present]`.

**Do not read a clean step 4 as evidence that step 2 was unnecessary.** The score is identical before and after the fold (97/A either way on a CV carrying the competencies defect), because the two stages look at different things.

If the user only wants the score on an already-generated CV, steps 4-7 stand alone — the payload stage needs the payload, which exists before the HTML.

## Rules

- **Read-only.** The checker reads one HTML file and writes nothing. `ats-payload.mjs` consumes a payload and emits a new one, and writes nothing either — in particular never `cv.md` or `config/profile.yml`. Both respect `DATA_CONTRACT.md`.
- **Advisory, not a gate.** Unlike `verify-cv-facts.mjs`, neither tool is part of the `pdf` hard-gate chain. Surface the fold, the lint findings, the score and the issues to the user; do not block generation on any of them.
- **Never apply a lint finding yourself.** The three lints exist precisely because each needs a judgement the user owns — an employer name inside a role, where a parenthetical detail belongs, which bullets belong to which stint. Rewriting a job title or an employer name on the user's behalf is fabrication under AGENTS.md § "Source-of-Truth Boundary", and a silent rewrite is worse than the mangling it prevents. Relay the finding; if the user decides, write the change to the user-layer file through the normal confirm-before-write path.
- **Deterministic.** Same HTML in, same score out; same payload in, same payload out — no model calls, no network, in either tool.
- **Localize at the presentation boundary.** `verify-ats.mjs` and `ats-payload.mjs` both emit fixed English by design (zero-LLM). When you relay its score and issues to the user, render the human-facing summary in `{language.output}` per AGENTS.md § "Output Language vs Market Modes" using the `[Render in {language.output}: …]` mechanism. Keep the checker's raw stdout English; only the surfaced summary is translated. The same applies to the payload stage's lint findings on stderr — and note that `ats-payload.mjs`'s *stdout* is a payload, not prose: never translate it.
- Issues describe structural risk, not facts. For fact/fabrication guarding, use `verify-cv-facts.mjs`.
