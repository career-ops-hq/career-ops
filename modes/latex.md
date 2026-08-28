# Mode: latex — LaTeX/Overleaf CV Export

Export a tailored, ATS-optimized CV as a `.tex` file and compile it to PDF via `tectonic` or `pdflatex`.

## Pipeline

1. Read `cv.md` as source of truth
2. Read `config/profile.yml` for candidate identity and contact info
3. Ask the user for the JD if not already in context (text or URL)
4. Extract 15-20 keywords from the JD
5. Detect JD language → CV language (EN default)
6. Detect role archetype → adapt framing
7. Rewrite Professional Summary injecting JD keywords (same rules as `pdf` mode — NEVER invent skills)
8. Select top 3-4 most relevant projects for the offer, and populate `awards[]` from `cv.md`'s Awards / Honors section when it has entries that support the role (omit the key otherwise — the section is dropped, header included; never invent an award)
9. Reorder experience bullets by JD relevance
10. Inject keywords naturally into existing achievements
11. Build a JSON payload (see schema below) and write to `/tmp/cv-{candidate}-{company}.json`
12. Run: `node build-cv-latex.mjs /tmp/cv-{candidate}-{company}.json output/cv-{candidate}-{company}-{YYYY-MM-DD}.tex`
13. Run: `node generate-latex.mjs output/cv-{candidate}-{company}-{YYYY-MM-DD}.tex output/cv-{candidate}-{company}-{YYYY-MM-DD}.pdf`
    *(Replace `{candidate}`, `{company}`, `{YYYY-MM-DD}` with actual values.)*
14. Report: .tex path, .pdf path, file sizes, section count, keyword coverage %

**Requires:** `tectonic` (preferred — `brew install tectonic`, auto-downloads packages) or `pdflatex` (MiKTeX / TeX Live) on PATH.

## Language support

- **Localized section titles are fine.** The validator counts `\section{}` blocks instead of matching English titles, so a Spanish/French/German CV (e.g. `\section{Educación}`) validates normally.
- **CJK (Japanese / Chinese / Korean) is NOT supported on this path yet.** The template is a pdfLaTeX / Computer-Modern setup with no CJK font, so kana/kanji/hangul cannot render. `generate-latex.mjs` detects CJK characters and stops with guidance. For a Japanese CV, use `pdf` mode (HTML → PDF), which renders CJK via a `lang="ja"` font fallback.

## JSON Input Schema

Write a JSON file with this structure. `build-cv-latex.mjs` handles template merge and LaTeX escaping — no need to escape special characters yourself.

```json
{
  "name": "Jane Smith",
  "contact_line": "San Francisco, CA | +1 415 555 0100",
  "email": { "url": "jane@example.com", "display": "jane@example.com" },
  "linkedin": { "url": "https://linkedin.com/in/janesmith", "display": "linkedin.com/in/janesmith" },
  "github": { "url": "https://github.com/janesmith", "display": "github.com/janesmith" },
  "education": [
    {
      "institution": "University Name",
      "location": "City, State",
      "degree": "Bachelor of Science in Computer Science",
      "dates": "2018 - 2022",
      "coursework": ["Data Structures", "Algorithms", "Machine Learning"]
    }
  ],
  "experience": [
    {
      "company": "Company Name",
      "role": "Job Title",
      "location": "Remote",
      "dates": "June 2022 - Present",
      "bullets": [
        "Achievement bullet with JD keywords injected",
        "Another bullet with quantified impact"
      ]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "context": "Tech stack summary for the project line",
      "dates": "",
      "bullets": [
        "What you built and what it does"
      ]
    }
  ],
  "awards": [
    { "title": "Gold Medal, International Olympiad in Informatics", "org": "IOI", "year": "2021" }
  ],
  "skills": [
    { "category": "Languages", "items": "Python, JavaScript, C++" },
    { "category": "Frameworks", "items": "FastAPI, React, PyTorch" }
  ]
}
```

### Field reference

| Field | Type | Source |
|-------|------|--------|
| `name` | string | `profile.yml → candidate.full_name` |
| `contact_line` | string | Phone / City, State / Visa — built from profile.yml |
| `email.url` | string | Email for `\href{mailto:...}` (sanitized via sanitizeUrl, not LaTeX-escaped) |
| `email.display` | string | Display text for the email link |
| `linkedin.url` | string | Full URL with scheme for `\href{}` (sanitized via sanitizeUrl, not LaTeX-escaped) |
| `linkedin.display` | string | Display text only (no scheme) |
| `github.url` | string | Full URL with scheme for `\href{}` (sanitized via sanitizeUrl, not LaTeX-escaped) |
| `github.display` | string | Display text only (no scheme) |
| `education[].institution` | string | From cv.md Education |
| `education[].location` | string | Institution location |
| `education[].degree` | string | Degree name |
| `education[].dates` | string | Date range |
| `education[].coursework` | string[] | Optional — generates a coursework line if present. Renders as a bullet, so it supports the same `**…**` emphasis |
| `experience[]` | object[] | Optional — omit the key or pass `[]` and the Work Experience section is dropped, header included. For candidates with no professional history yet (students, new graduates, career changers); never drop it to hide a gap |
| `experience[].company` | string | From cv.md Experience |
| `experience[].role` | string | Job title |
| `experience[].location` | string | Work location |
| `experience[].dates` | string | Date range |
| `experience[].bullets` | string[] | Reordered and keyword-injected achievement bullets. Wrap a span in `**…**` to emphasise it — the builder renders it as `\textbf{…}` after escaping (see **Markdown bold in bullets** below) |
| `projects[].name` | string | From cv.md Projects |
| `projects[].context` | string | Tech stack — appears next to project name |
| `projects[].dates` | string | Date range (or empty) |
| `projects[].bullets` | string[] | Selected project achievements. Supports the same `**…**` emphasis |
| `awards[].title` | string | Award name, from cv.md Awards / Honors |
| `awards[].org` | string | Optional — issuing body, rendered after the title |
| `awards[].year` | string | Optional — year, right-aligned |
| `skills[].category` | string | Skill category name (e.g. "Languages", "Frameworks") |
| `skills[].items` | string | Comma-separated skills in that category |

## LaTeX Escaping (handled by the script)

`build-cv-latex.mjs` automatically escapes all user-supplied text before insertion:

| Character | Escape |
|-----------|--------|
| `&` | `\&` |
| `%` | `\%` |
| `$` | `\$` |
| `#` | `\#` |
| `_` | `\_` |
| `{` | `\{` |
| `}` | `\}` |
| `~` | `\textasciitilde{}` |
| `^` | `\textasciicircum{}` |
| `\` | `\textbackslash{}` |
| `±` | `$\pm$` |
| `→` | `$\rightarrow$` |

**Exception:** URLs inside `\href{}` are NOT escaped by the LaTeX escaper, but `sanitizeUrl()` still validates the scheme (mailto/http/https) and removes dangerous characters to prevent injection.

## Markdown Bold in Bullets

`experience[].bullets`, `projects[].bullets` and `education[].coursework` accept `**…**` around a span you want emphasised — typically the quantified result a recruiter should catch in the six-second scan:

```json
"bullets": ["Cut p99 latency from 840 ms to **120 ms** across 14 services"]
```

renders as `\textbf{…}` in the `.tex`. This is the LaTeX half of the same support the HTML path has had since #1728, so **in bullets** one payload emphasises the same way in both output formats.

**The support is bullet-scoped on this side.** Everything this builder emits inside a `\resumeItem` goes through it — `experience[].bullets`, `projects[].bullets`, and the `education[].coursework` line. Every other field (`projects[].name`, `projects[].context`, `awards[].title`, `skills[].category`, `skills[].items`) still renders `**` literally here, while the HTML path bolds them. Keep `**…**` out of those fields unless you are producing HTML only.

**The escaping runs first, and that order is the safety property.** `escapeLatex()` neutralises every backslash and brace before the `**` markers are reinterpreted, so a literal `\textbf{...}` typed into a bullet stays inert text and a bold span keeps its `\&`, `\$`, `\%` escaping intact. Only `**`-delimited spans are affected; single asterisks and unmatched markers stay literal.

**A bold span cannot contain a `*`.** `**tripled *3x* throughput**` matches nothing and ships the asterisks literally — no error, no warning. Rewrite it as `**tripled 3x throughput**` rather than nesting emphasis. The HTML path has the same limit (it is the same regex), so this is a rule about the payload, not about the output format.

Emphasis is not a substitute for evidence — bold reorders attention, it does not add claims. The no-fabrication rule applies to bolded text exactly as it does to the rest of the bullet.

## ATS Rules (same as pdf mode)

- Single-column layout (enforced by template)
- Standard section headers: Education, Work Experience, Personal Projects, Awards & Honors, Technical Skills
- Optional sections (Work Experience, Personal Projects, Education, Awards & Honors, Technical Skills) are dropped entirely — header included — when their array is empty or absent
- UTF-8, machine-readable via `\pdfgentounicode=1`
- Keywords distributed: first bullet of each role, skills section
- No images, no graphics, no color in body text

## Keyword Injection Strategy

Same ethical rules as `modes/pdf.md`:
- NEVER add skills the candidate doesn't have
- Only reformulate existing experience using JD vocabulary
- Examples:
  - JD says "RAG pipelines" → reword "LLM workflows with retrieval" to "RAG pipeline design"
  - JD says "MLOps" → reword "observability, evals" to "MLOps and observability"

## Overleaf Compatibility

The generated `.tex` file uses only standard CTAN packages (no custom or bundled dependencies):

- `latexsym`, `fullpage`, `titlesec`, `marvosym`, `color`, `verbatim`, `enumitem`
- `hyperref`, `fancyhdr`, `babel`, `tabularx`, `fontawesome5`, `multicol`, `glyphtounicode`

Upload the `.tex` file directly to Overleaf — compiles with no extra configuration.
