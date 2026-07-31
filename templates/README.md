# Templates

System-layer template files used by career-ops scripts and modes. These files are auto-updated when you run `npm run update` -- put user customizations in the user-layer files instead (see DATA_CONTRACT.md).

## Files

| File | Used By | Purpose |
|------|---------|---------|
| `cv-template.html` | `generate-pdf.mjs` | HTML/CSS template for ATS-optimized CV PDFs |
| `resume-template.html` | `generate-pdf.mjs` (via `--template`) | Resume-branded variant of `cv-template.html`. Same layout and placeholder tokens; differs in: `<title>` reads "Resume" instead of "CV", omits Certifications section (but keeps Awards & Honors), targets 1–2 page US/industry format. See detailed section below. |
| `cv-template.tex` | `generate-latex.mjs` | LaTeX/Overleaf template for ATS-optimized CV PDFs |
| `portals.example.yml` | Onboarding | Example portal scanner configuration (copy to `portals.yml` to activate) |
| `states.yml` | `verify-pipeline.mjs`, `normalize-statuses.mjs`, `merge-tracker.mjs` | Canonical application states and their aliases |
| `restrictive-covenants.yml` | `modes/offer-prep.md` (statutory-context notes) | Jurisdiction-keyed table of restrictive-covenant statutory rules, per covenant type (v1: non-compete only — seeds US-CA B&P §16600/§16600.5 and Ontario ESA s.67.2). Status spectrum: `prohibited` / `allowed_with_mandatory_compensation` / `allowed_with_limits` / `common_law_reasonableness`. Prompt-level data reference — no script reads it; local lookup, never online research. Feeds statutory-context notes and targeted lawyer questions; never a verdict about the candidate's clause. Contribution rule: no entry without a citable legal source, an effective date, and an `as_of` verification date; covenant types are never conflated. |
| `protected-grounds.yml` | `modes/interview-redflag.md` (Step 2c — protected-grounds question detection) | Jurisdiction-keyed table of protected grounds / do-not-ask topics in hiring (seeds: CA-ON — Ontario Human Rights Code s.5(1), 16 grounds; JP — MHLW 公正な採用選考 fair-hiring 14-item do-not-ask list, bilingual Japanese terms + English glosses). Prompt-level data reference — no script reads it; local lookup over local transcripts, nothing leaves the machine. Feeds topic-match observations weighed by the mode's existing evidence tiers; per-ground `legitimate_contexts` (BFOR, accommodation, post-offer) prevent false flags. Never a legal verdict — "touches {ground}, protected under {legal basis}", never "this was illegal". Contribution rule: no entry without a citable legal source (regulator/ministry guidance preferred) and an `as_of` verification date. |
| `agency-licensing.yml` | `modes/oferta.md` (Block G signal 10) | Jurisdiction-keyed table of agency/recruiter licensing regimes with official public registry lookups (e.g. Ontario THA/recruiter licensing mandatory since 2024-07-01, ministry status checker on ontario.ca). Prompt-level data reference — no script reads it, nothing ever fetches or scrapes a registry URL. Contribution rule: no entry without a regulator-grade source, an effective date, an `as_of` verification date, and an official government registry URL (never a third-party mirror). |
| `immigration-status-requirements.yml` | `modes/oferta.md` (Block G immigration-status signal), `modes/apply.md` (Step 5d) | Jurisdiction-keyed table of immigration-status requirements employers may not demand (e.g. "US citizens only" under 8 U.S.C. §1324b, the *Haseeb* permanence proxy under Ontario's Human Rights Code). Every row carries a mandatory `lawful_screening_contrast` — authorization/sponsorship questions are lawful and never flagged. Prompt-level data reference, agent-judged matching — no script reads it. Contribution rule: no entry without a citable legal source, `as_of` date, and non-empty `lawful_screening_contrast`. |

| `jurisdiction-prohibited-content.yml` | `modes/oferta.md` (Block G signal 10), `modes/apply.md` (Step 5c) | Jurisdiction-keyed table of content employers are legally prohibited from requiring/asking for (e.g. "Canadian experience" in Ontario postings, salary-history questions in California). Prompt-level data reference, agent-judged matching — no script reads it. Contribution rule: no entry without a citable legal source and effective date. |

### cv-template.html

The HTML template rendered by Playwright into PDF. Uses placeholder tokens (`{{NAME}}`, `{{SUMMARY_TEXT}}`, `{{EXPERIENCE}}`, etc.) that the PDF pipeline fills at generation time.

**Design:** Space Grotesk headings + DM Sans body, single-column ATS-safe layout, self-hosted fonts from `fonts/`.

**Customization:** Edit this file to change colors, spacing, or section order. The placeholder tokens are documented in `batch/batch-prompt.md` under "Template placeholders."

**Optional sections:** Projects, Education, Certifications, and Awards & Honors are dropped in full — section header included — when the payload carries no entries for them (see `cv-sections-core.mjs`). Their markers (`<!-- PROJECTS -->`, `<!-- AWARDS -->`, …) are what the strip matches on, so renaming or removing a marker disables the strip for that section.

### resume-template.html

Resume-branded variant of `cv-template.html` for US/industry job applications. Key differences from the CV template:

- **Title** reads "Resume" instead of "CV"
- **No Certifications section** — resumes focus on recent, relevant experience
- **Designed for 1–2 pages** — omits academic-style sections
- **Awards & Honors is kept** — unlike Certifications. A contest medal or dean's list is a competitive signal rather than academic filler, and it is the strongest line an early-career candidate has when the experience section is thin. It costs nothing when unused: no entries means no section.

Otherwise uses the same placeholder tokens (`{{NAME}}`, `{{SUMMARY_TEXT}}`, etc.) and is fully compatible with the existing PDF pipeline.

**Keep in sync:** When updating `cv-template.html`, apply matching changes to `resume-template.html` (preserving the differences noted above).

### cv-template.tex

LaTeX template for Overleaf-compatible CV generation. Based on the [sb2nov/resume](https://github.com/sb2nov/resume) format. Uses placeholder tokens (`{{NAME}}`, `{{EXPERIENCE}}`, `{{PROJECTS}}`, etc.) that the LaTeX pipeline fills at generation time.

**Design:** Single-column ATS-safe layout using standard CTAN packages (`fontawesome5`, `enumitem`, `hyperref`, `titlesec`). No custom fonts or external dependencies — uploads directly to Overleaf.

**Usage:**
```bash
# Validate and compile .tex → .pdf (requires pdflatex on PATH)
node generate-latex.mjs output/cv-name-company-date.tex

# Or specify a custom output path
node generate-latex.mjs output/cv-name-company-date.tex output/custom-name.pdf
```

**Prerequisites:** `pdflatex` via [MiKTeX](https://miktex.org/) (Windows) or TeX Live (Linux/macOS). First compilation may auto-install missing LaTeX packages. Alternatively, upload the `.tex` file directly to [Overleaf](https://www.overleaf.com) — no local install needed.

**Customization:** Edit this file to change margins, section order, or formatting commands. The placeholder tokens are documented in `modes/latex.md` under "Template Placeholders."

### portals.example.yml

Pre-configured portal scanner with 45+ tracked companies and search queries. Contains title filters, company career page URLs, Greenhouse API endpoints, and WebSearch queries.

**To activate:** Copy to project root as `portals.yml` and customize `title_filter.positive` keywords for your target roles. Add or remove companies as needed.

### states.yml

Defines the 9 canonical application states (`Evaluated`, `Applied`, `Responded`, `Interview`, `Offer`, `Hired`, `Rejected`, `Discarded`, `SKIP`) with aliases for common variants. All pipeline scripts validate statuses against this file.

**Do not rename states** -- the dashboard and all scripts depend on these exact IDs. You can add aliases if you encounter new variants that should map to an existing state.
