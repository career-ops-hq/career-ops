# Mode: cv-ingest, CV to clean cv.md (proposer)

Converts a person's CV (pasted text, or a local PDF/DOCX file) into clean,
well-structured GitHub-flavored markdown for their `cv.md`. It is a **proposer,
never a writer**: it emits candidate markdown only. The human, or the web's
review step, confirms before anything is saved.

> **Why this is core and not web-only:** web onboarding and CLI onboarding must
> parse a CV into the same `cv.md` shape, or the A-F evaluation reads a different
> CV depending on how the user set up. This mode is the single source of truth for
> "CV to cv.md", the way `modes/oferta.md` is for scoring. The web runs it headless
> (`web/src/app/api/cv/ingest/route.ts` reads this file); a CLI user gets it
> through onboarding.

## The proposer-not-writer contract (read this first)

`cv-ingest` **never writes `cv.md`** (or any file). It only proposes the parsed
markdown. The save is a separate, explicit step:

- **Web:** the agent emits the markdown wrapped in `<<cv:start>>` / `<<cv:end>>`
  markers. The web shows it in a review pane and writes it through the canonical CV
  write path only after the user clicks Save.
- **CLI:** print the markdown, then ask "Save this to cv.md? (y/n)". Only on yes,
  write it. If `cv.md` already exists, **back it up first** (`cv.md.bak`) and ask
  before overwriting. Never blind-overwrite a hand-tuned CV (see `DATA_CONTRACT.md`).

Headless callers enforce this structurally by running the agent with
Write/Edit/Bash disabled, so it cannot persist even by mistake.

## Input

One of:
- **Pasted text:** the CV as plain text, or a LinkedIn "About"/experience paste.
  Use it directly; no file needed.
- **A local file path:** a `.pdf`, `.docx`, `.md` or `.txt`. Read it with your
  file-read tool. A `.md`/`.txt` is already markdown-ish, so clean it lightly; a
  PDF/DOCX needs full extraction and structuring.

Never fetch a remote URL or send the CV anywhere. The CV is the user's most
private data and stays local.

## Output: the cv.md markdown

**The format source of truth is `examples/cv-example.md`**, the reference CV the
project ships. Produce markdown that mirrors it: same structure, heading style and
section names, so a CV parsed here has the same shape as one a user wrote by hand
from the example. Read that file if unsure; if it changes, follow it. The shape, in
this order (omit a section if the source lacks it, and invent nothing):

```markdown
# CV -- {Full Name}

**Location:** {...}
**Email:** {...}
**LinkedIn:** {...}
**Portfolio:** {... if any}
**GitHub:** {... if any}

## Professional Summary

{2-4 line summary in their voice, only from facts present. Never embellish.}

## Work Experience

### {Company} -- {Location}

**{Job Title}**
{Start}-{End or Present}

- {Bullet. Preserve quantified achievements verbatim: numbers, %, scale, impact}
- {...}

### {next company...}

## Projects

- **{Project}** ({type, e.g. Open Source}) -- {one-line what + the hero metric or outcome}

## Education

- {Degree}, {Institution} ({year if given})

## Skills

- **{Category}:** {comma-separated list, in the user's own terms}
```

**Format rules (match the example):**
- The title is `# CV -- {Name}`. Contact details are bold lines directly under the
  title (no "Contact" section). Headings are `## Professional Summary`,
  `## Work Experience`, `## Projects`, `## Education`, `## Skills`.
- Experience is company-first: `### {Company} -- {Location}`, then the job title on
  its own bold line, then the dates on their own line, then bullets.
- Use `--` (double hyphen), never an em dash. `modes/_shared.md` forbids em dashes
  (an ATS-compatibility rule) and the example uses `--` throughout.

**Fidelity rules:**
- **Preserve every** company, job title, date range and **quantified achievement**
  (latency cut 40%, $2M saved, 2K stars, team of 5). These are the proof points the
  A-F evaluation scores against; losing them weakens every later match.
- **Invent nothing.** If a fact (a date, a metric, an email) is not in the source,
  omit it. A faithful gap beats a fabricated detail.
- **Clean, don't rewrite.** Fix formatting, normalize headings, de-duplicate, but
  keep the candidate's wording and emphasis. It is their CV.
- Keep the size reasonable. A CV that parses to an enormous file usually means the
  whole PDF (page furniture, repeated headers) leaked in. Extract just the CV.

## Machine channel (for the web)

When run headless for the web, emit only the markdown wrapped between two marker
lines, each on its own line and never inside a code fence:

```
<<cv:start>>
# CV -- {Full Name}
...the full cv.md markdown...
<<cv:end>>
```

Then emit one more line: a JSON seed the web uses to start a free job search
derived from the CV, so the user sees matches before any other setup. Keep it one
line and one flat object (no nested braces; the parser reads up to the first `}`):

```
<<cv:seed>>{"title":"<their current or target role>","roles":["<3-5 role keywords they would search>"],"location":"<their location, or 'Remote'>"}
```

If the source is unreadable or empty (a scanned-image PDF with no text layer, an
empty paste), emit only this and stop:

```
<<cv:error>>{"reason":"unreadable"}
```

Narrate one short line before `<<cv:start>>` (for example "Reading your CV...") so
the web can show progress. Everything outside the markers is treated as narration.

## Human channel (direct CLI use)

For onboarding from the terminal: after extracting, print the markdown plainly,
then ask:

```
Here's your CV as markdown. Save it to cv.md? (y / edit / n)
```

- **y:** if `cv.md` exists, copy it to `cv.md.bak` first, then write. If it is
  absent, just write.
- **edit:** let them tweak before saving.
- **n:** do not save; offer to adjust and re-show.

Then point them at the next step: "Saved. Run `/career-ops scan` to find roles, or
paste a job URL and I'll score it against your CV."

## Degrade

- **Scanned-image PDF (no text layer):** you cannot extract text. Emit
  `<<cv:error>>` (web) or "I couldn't read text from that PDF. Paste your CV text
  instead" (CLI).
- **A CLI without file-read:** if you cannot open the given path, say so and ask for
  a paste. Never guess the contents.
- **Thin source:** parse what is there and flag it ("this looks brief, add your
  experience for better matches"). A minimal CV is enough for a first useful score.

## Summary contract

- **Proposer, never writer.** Emit candidate markdown; the human or the web saves it.
- **Local and private.** The CV never leaves the machine; no remote fetch.
- **Faithful.** Preserve every company, title, date and metric; invent nothing; clean, don't rewrite.
- **Two channels:** `<<cv:start/end/seed/error>>` markers for the web; a y/edit/n save prompt for the CLI (back up an existing `cv.md` before overwriting).
