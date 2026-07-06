# Mode: add — Add a project, paper, or role to your CV

Fetch a finished project / paper / internship from a link (or plain text), turn
it into ATS-style CV content **grounded only in what the source actually says**,
preview it, and — after you confirm — append it to `cv.md` and (for projects)
`article-digest.md`. Deterministic dedup and insertion are handled by
`add-entry.mjs`, so re-adding the same thing is a safe no-op.

> **Non-negotiables (from the project's source-of-truth rules in `_shared.md`):**
> - **Confirm before write.** Never touch `cv.md` / `article-digest.md` until the
>   user approves the preview.
> - **Never fabricate.** Every bullet, metric, and date must be backed by the
>   fetched page or the user's own words. If the source doesn't state it, it does
>   not go in. Keywords get reformulated, never invented.
> - **Zero-key, local.** Use only public, no-auth fetches (GitHub's public API,
>   WebFetch). No API keys, no third-party services.

## Input

`$mode` after `add` is the source. Accept any of:
- a **GitHub repo URL** (`github.com/<owner>/<repo>`)
- a **paper / publication link** (arXiv, DOI, journal, personal page)
- a **project / portfolio page URL**
- **plain text** the user pastes describing the work

If no source was given, ask the user for one.

## Pipeline

1. **Load context.** Read `cv.md` (its existing section names and formatting are
   the template to match) and `article-digest.md` if present.
2. **Fetch the source (zero-key):**
   - **GitHub repo** → the public REST API (`https://api.github.com/repos/<owner>/<repo>`
     for name/description/topics/language/stars/timestamps) **plus** the README
     via WebFetch. No token required for public repos.
   - **Any other link** → WebFetch. Only fall back to Playwright if the page is
     JS-rendered and WebFetch returns nothing useful.
   - **Plain text** → use it directly as the source; do not invent beyond it.
3. **Extract structured facts** actually present in the source: name, dates /
   period, tech stack, role, and concrete outcomes/metrics. Leave anything the
   source doesn't state **blank** — do not guess.
4. **Classify the entry type → target CV section** (see table). Placement is
   inferred, but shown in the preview; only ask the user when it's genuinely
   ambiguous.
5. **Write ATS bullets from the extracted facts** — 2–4 concise, quantified-where-the-
   source-supports-it bullets, matching the bullet style already used in `cv.md`.
   For a **project**, also compose an `article-digest.md` block (`## <Name> — <tagline>`
   with `**Hero metrics:**`, `**Architecture:**`, `**Key decisions:**`,
   `**Proof points:**`), filling only what the source supports.
6. **Preview.** Show, as a diff-style preview: the inferred CV section, the exact
   markdown to be inserted into `cv.md`, and (for projects) the `article-digest.md`
   block. Flag anything you could not source.
7. **Confirm gate.** Ask the user to approve, edit, or cancel. Do **not** proceed
   without an explicit yes.
8. **Write via the helper.** Build the payload (schema below), write it to
   `/tmp/add-<slug>.json`, then run:

   ```bash
   node add-entry.mjs /tmp/add-<slug>.json
   ```

   (Add `--dry-run` first if the user wants to see the file-level change without
   writing.)
9. **Report** the helper's JSON result. If a target comes back `duplicate`, tell
   the user it was already present and nothing was changed.

## Section inference

| Source is… | CV section |
|------------|------------|
| a code project / repo / tool | `Projects` |
| a paper / publication / preprint | `Publications` (create if absent) |
| an internship / job / role | `Work Experience` |
| a talk / course / certification | `Education` (or ask if unclear) |

`add-entry.mjs` creates the section heading if it doesn't exist yet, so a new
`## Publications` is fine.

## Payload schema (input to `add-entry.mjs`)

Both keys optional; provide at least one. `articleDigest` is for projects only.

```json
{
  "cv": {
    "section": "Projects",
    "dedupKey": "<short canonical name, e.g. the repo/project name>",
    "entry": "<exact markdown to insert — a bullet for Projects, or a\n### Org — Location / **Title** / dates / bullets block for Work Experience>"
  },
  "articleDigest": {
    "dedupKey": "<same canonical name>",
    "entry": "## <Name> — <tagline>\n\n**Hero metrics:** ...\n\n**Architecture:** ...\n\n**Key decisions:**\n- ...\n\n**Proof points:**\n- ..."
  }
}
```

`dedupKey` is normalized (case- and punctuation-insensitive) to detect an entry
that's already there, so the command is idempotent.

## Rules

- Match the existing `cv.md` formatting exactly (heading levels, bullet style,
  date format) — the file is the template.
- One entry per run. To add several, run `add` per item.
- If the fetch fails or the page has no usable content, say so and stop — never
  synthesize an entry from nothing.
- Personal data (the CV itself) stays local; the fetch only reads public sources.
