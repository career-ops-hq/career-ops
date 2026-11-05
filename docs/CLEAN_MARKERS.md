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
- **`--keep-script-joiners`** (audit and clean) keeps the zero-width joiners that some text needs to be
  spelled right, so a Persian cover letter or a CV with an emoji can pass `audit`.

### Script joiners (`--keep-script-joiners`)

By default `clean` strips, and `audit` fails on, every ZWJ (U+200D), ZWNJ (U+200C) and variation
selector. That is deliberate: a joiner placed between ordinary letters is the classic carrier of
zero-width steganography. But in emoji sequences (`👨‍💻`, `❤️`), Persian (`می‌خواهم`, where ZWNJ is
mandatory) and Brahmic scripts such as Hindi (`क्‍ष`), these characters are part of the spelling.

With `--keep-script-joiners`, a joiner is kept only when it is a single character in one of these
positions; `audit` and `clean` use the same rule, so they never disagree:

| Kept | Position |
|---|---|
| ZWJ | between two pictographs (an optional VS16 or skin tone may sit before it) |
| ZWNJ | between two Arabic-script letters (Persian, Urdu, ...) |
| ZWJ or ZWNJ | between two letters or marks of the same Brahmic script (Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala) |
| VS16 (U+FE0F) | directly after a pictograph |

Everything else is still stripped and reported: joiners next to Latin letters or spaces, at the start
or end of a line, between two different scripts, VS15 and other variation selectors, and any run of two
or more joiners. Digits never qualify, even Arabic-Indic or Devanagari ones. Each line of output says how many joiners were kept (`kept 3 script joiners`), so the
exception stays visible.

One single joiner in a qualifying position can still carry one bit, for example between two Persian
letters. That is why the flag is off by default: leave it off when you need zero tolerance.

## When to run

Before generated text leaves your machine or before rendering HTML/Markdown into a final document:

```bash
node clean-markers.mjs audit output/acme-cv.html output/acme-cover-letter.md
node clean-markers.mjs clean output/acme-cv.html output/acme-cover-letter.md
```

## Dependencies

None. The tool uses only Node's standard library. It never runs `npm install`, never edits PDFs, and
does not alter visible punctuation unless you pass `--ascii`.
