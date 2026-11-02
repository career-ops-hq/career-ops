---
name: cv
description: Build or update the user's CV and profile, then render a clean PDF (English and/or Ukrainian). Turns a pasted CV, an old PDF/DOCX in documents/, a LinkedIn profile or a short interview into cv.md + config/profile.yml, then renders output/General/CV.pdf with the chosen template. Use when the user says "/cv", "зроби резюме", "онови CV", "оформи резюме", "make my CV", or is setting career-ops up for the first time.
---

# cv — from "here's my experience" to a ready PDF

Reply in the user's language. Never invent facts: every line of the CV comes from what the user wrote or a document they gave (AGENTS.md → Source-of-Truth Boundary). If something is missing, ask; if they don't know, leave it out.

## 1. Get the facts into `cv.md`

First run: if `node_modules/` is missing, run `npm install` and `npx playwright install chromium` yourself (one status line, no questions). Then `node doctor.mjs --json --init-templates`, and:

- **`cv.md` missing** → ask ONE question: «Як тобі зручніше: (1) встав текст резюме сюди, (2) поклади PDF/DOCX у папку `documents/`, (3) дай посилання на LinkedIn, або (4) просто розкажи про досвід — я поставлю питання.»
  - Pasted text → convert it.
  - File in `documents/` → `node intake.mjs` extracts the text; propose what goes into `cv.md`, write after the user says OK.
  - LinkedIn → open it in their Chrome (Claude in Chrome, read-only) and read the page text; or ask them to paste it.
  - Interview → ask in small batches: current/last jobs (company, title, dates, 2-4 results each, with numbers if they have them), education, skills, languages, links.
- **`cv.md` exists** → ask what to change, edit only that.

Shape `cv.md` like `examples/cv-example.md` (the CV checks rely on it): `## Summary`, `## Experience` with each job as `### Company — Location`, a bold `**Title**` line, a dates line, bullets; then `## Projects` (optional), `## Education`, `## Skills`. Show the result and get a «так» before saving it.

## 2. Profile (first run only)

If `config/profile.yml` is missing, ask in one message: name, email, phone (optional), city + timezone, target roles, pay range + currency, whether they want the CV in English, Ukrainian or both. Write it with `node onboard-write.mjs --answers -` (AGENTS.md → First Run, Step 3; `spend_tier: standard` unless they said otherwise). Then:
- `cv.template: details` in `config/profile.yml` (clean black-on-white two-column layout) unless they picked another one (`node cv-templates.mjs list cv` shows all).
- `language.output: uk` when they talk to you in Ukrainian.
- Create `data/applications.md` if missing (AGENTS.md → First Run, Step 4).

## 3. Render the general CV

For each language they want:
1. Build the payload JSON per `modes/pdf.md` → **JSON Input Schema** from `cv.md` + `config/profile.yml` (no tailoring, no keyword injection — this is the general CV). Keep bullets short (one line each), 3-5 per job, at most 2 pages. Ukrainian: translate faithfully, `"lang": "uk"`, and localized `sections` titles (Про мене, Досвід роботи, Проєкти, Освіта, Навички).
2. Save it as `output/General/payload-en.json` / `payload-uk.json` (Write tool).
3. Template: `node cv-templates.mjs resolve cv` for English; `templates/cv-template.details-uk.html` for Ukrainian when the template is `details`.
4. `node build-cv-html.mjs output/General/payload-en.json output/General/CV.html <template>`
   `node generate-pdf.mjs output/General/CV.html output/General/CV.pdf --format=a4 --max-pages=2`
   (Ukrainian → `CV-UA.html` / `CV-UA.pdf`.)
5. If the PDF step reports a fact-check warning, show it and fix the payload, never the facts.

File names carry no name or date: `output/General/CV.pdf`, `CV-UA.pdf`. Tailored CVs from `/scan-all` go to `output/{Company}/CV.pdf`.

## 4. Finish

Open the PDF for them (`start "" "output/General/CV.pdf"` on Windows, `open` on macOS, `xdg-open` on Linux) and say what's next:
- `/fill-profile djinni` (or linkedin, workua, robotaua, dou, upwork) — I'll fill your job-site profile from this CV.
- `/scan-all` — find jobs and open the dashboard.

When they ask for a different look: `node cv-templates.mjs list cv`, then set `cv.template` in `config/profile.yml` and re-run step 3. Style rules they state («без кольорів», «без фото», «тільки одна сторінка») go into `modes/_custom.md` → Output Preferences, so every future CV follows them.
