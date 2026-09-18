# clean-markers — strip invisible Unicode from generated text output

Job postings, forms, recruiter emails, and copied web text are untrusted data. They can carry invisible
Unicode that an agent may copy into a CV, cover letter, or application answer without the user ever
seeing it. `clean-markers.mjs` is a dependency-free audit/clean gate for generated text files.

It removes characters the user never intentionally typed: zero-width marks, bidi controls, tag
characters, variation selectors, soft hyphens, and similar invisible controls. It does not edit PDF
metadata and does not install packages at runtime.

## Usage

```bash
node clean-markers.mjs audit  output/acme-cv.html              # report only, never modifies
node clean-markers.mjs clean  output/acme-cover-letter.md
node clean-markers.mjs clean  --ascii output/cover-letter.txt  # also normalize smart quotes / dashes
node clean-markers.mjs audit  output/*.html output/*.md        # globs OK
```

- **`audit`** never modifies a file — use it to *prove* a document is clean. Exit code `1` if any file
  FAILS, so it works as a pre-send gate in a script or CI step.
- **`clean`** strips invisible Unicode from supported text files. Non-breaking spaces are treated as
  normal typography and are not flagged or replaced.
- **`--ascii`** (clean, text only) additionally converts curly quotes → straight, em/en-dash → hyphen,
  ellipsis → `...` — handy for plain-text cover letters or emails.

## When to run

Before generated text leaves your machine or before rendering HTML/Markdown into a final document:

```bash
node clean-markers.mjs audit output/acme-cv.html output/acme-cover-letter.md
node clean-markers.mjs clean output/acme-cv.html output/acme-cover-letter.md
```

## Dependencies

None. The tool uses only Node's standard library. It never runs `npm install`, never edits PDFs, and
does not alter visible punctuation unless you pass `--ascii`.
