---
name: career-ops
description: >-
  AI job search command center -- evaluate offers, generate CVs, scan portals,
  track applications. Use when the user pastes a job URL or JD, asks to scan
  portals, generate a CV/PDF, track applications, prepare for interviews, draft
  outreach/emails, or run any career-ops mode.
arguments: mode
user_invocable: true
user-invocable: true
argument-hint: "[scan | discover | deep | pdf | text | latex | latex-tex | cover | email | add | expand | eu-swe | oferta | ofertas | apply | batch | tracker | agent-inbox | pipeline | contacto | training | project | interview-prep | interview | interview/plan | interview/practice | interview/debrief | interview-redflag | patterns | offer-prep | titles | upskill | followup | reply-watch | outcome | update]"
license: MIT
---

# career-ops -- Router

career-ops is a multi-CLI job-search command center. The routing below is shared across supported agent CLIs even when the invocation surface differs.

## Project Root Resolution

Before reading any repo-relative path, derive `PROJECT_ROOT` from this loaded `SKILL.md`: start at the skill file's directory and walk upward until the nearest directory containing both `AGENTS.md` and `modes/`. Resolve every path in this router (`modes/`, `config/`, `data/`, scripts, templates, and output paths) against `PROJECT_ROOT`, never against the process's current working directory. This is required even when the checkout itself is nested (for example `Development\\career-ops`) or the command starts from a subdirectory. If those two sentinels cannot be found, stop and locate the career-ops checkout before reading or writing files.

## Invocation Notes

- CLIs with slash-command registration can expose this router as `/career-ops`.
- In Cursor, this skill lives at `.cursor/skills/career-ops/` and is auto-discovered; ask for a mode by name, or paste a JD/URL to trigger auto-pipeline.
- Interactive Codex sessions use `codex` in the repo root. Slash commands are not guaranteed in Codex, so ask Codex to run the same mode by name if `/career-ops` is unavailable.
- Headless Codex workers use `codex exec "prompt"`.
- The routing semantics below stay the same regardless of whether the entrypoint is a slash command or a natural-language prompt.

Codex prompt examples that map to the same router semantics:

```markdown
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode and summarize new matches.
Run the career-ops pipeline mode for data/pipeline.md.
Run the career-ops pdf mode for the latest evaluated role.
Run the career-ops tracker mode and summarize the current statuses.
```

## Mode Routing

Determine the mode from `$mode`:

| Input | Mode |
|-------|------|
| (empty / no args) | `discovery` -- Show command menu |
| JD text or URL (no sub-command) | **`auto-pipeline`** |
| `oferta` | `oferta` |
| `ofertas` | `ofertas` |
| `contacto` | `contacto` |
| `deep` | `deep` |
| `interview-prep` | `interview-prep` |
| `interview` | `interview` |
| `eu-swe` | `regional/eu-swe` |
| `eu-fintech` | `regional/eu-fintech` |
| `interview/plan` | `interview/plan` |
| `interview/practice` | `interview/practice` |
| `interview/debrief` | `interview/debrief` |
| `pdf` | `pdf` |
| `text` | `text` |
| `latex` | `latex` |
| `latex-tex` | `latex-tex` |
| `email` | `email` |
| `add` | `add` |
| `expand` | `expand` |
| `training` | `training` |
| `project` | `project` |
| `tracker` | `tracker` |
| `agent-inbox` | `agent-inbox` |
| `inbox` | `agent-inbox` |
| `pipeline` | `pipeline` |
| `apply` | `apply` |
| `scan` | `scan` |
| `discover` | `discover` |
| `batch` | `batch` |
| `patterns` | `patterns` |
| `offer-prep` | `offer-prep` |
| `titles` | `titles` |
| `upskill` | `upskill` |
| `followup` | `followup` |
| `reply-watch` | `reply-watch` |
| `outcome` | `outcome` |
| `interview-redflag` | `interview-redflag` |
| `update` | `update` |
| `cover` | `cover` |

**Auto-pipeline detection:** If `$mode` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `auto-pipeline`.

If `$mode` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Output Language Directive

Before executing any mode, read `config/profile.yml` if it exists and resolve:

- `language.output` → ISO language code for human-facing output. Default: `en`.
- `language.modes_dir` → optional market-mode directory. This controls market vocabulary and local evaluation rules only.

Inject this directive after loading the mode instructions and before producing any user-visible content:

> Write all human-facing output in `{language.output}` regardless of the language of these instructions or of the job description. This includes reports, tracker notes, PDFs, cover letters, outreach, interview prep, form answers, and summaries. If `language.modes_dir` supplies market-specific vocabulary, keep the market logic but explain terms in `{language.output}` when needed.

`language.output` is authoritative for prose. `modes_dir` is market context; it must not force the prose language.

---

## Discovery Mode (no arguments)

If invoked without arguments, show this exact menu:

```markdown
## career-ops — Command Center

Welcome, Vinícius! Your career-ops pipeline is ready. Paste any job URL or job description text directly to trigger the full evaluation pipeline, or choose from the commands below:

---

### Core Pipeline Commands

| Command | Description |
| :--- | :--- |
| `/career-ops {JD or URL}` | **AUTO-PIPELINE:** Full evaluation (Score A-F) + structured report + ATS-optimized PDF CV + tracker entry. |
| `/career-ops pipeline` | Process and evaluate pending job URLs saved in [`data/pipeline.md`](data/pipeline.md). |
| `/career-ops oferta` | Evaluation only (Blocks A-F analysis, fit score, key strengths & gaps) without auto-generating PDF. |
| `/career-ops ofertas` | Compare and rank multiple job postings side by side to prioritize targets. |
| `/career-ops scan` | Zero-token ATS portal scanner across Greenhouse, Ashby, and Lever. |
| `/career-ops pdf` | Compile your latest ATS-optimized CV into PDF via Playwright. |
| `/career-ops text` | Generate a tailored markdown CV mirroring [`cv.md`](cv.md) (no PDF). |
| `/career-ops latex` | Export CV as LaTeX/Overleaf .tex format. |
| `/career-ops tracker` | View full status overview of all tracked applications in [`data/applications.md`](data/applications.md). |

---

### Interview Preparation & Outreach

| Command | Description |
| :--- | :--- |
| `/career-ops interview-prep` | Generate a comprehensive, company-specific interview prep dossier. |
| `/career-ops interview/plan` | Build a time-blocked preparation plan tailored to an upcoming interview round. |
| `/career-ops interview/practice` | Interactive mock interview session: one question at a time with real-time feedback. |
| `/career-ops interview/debrief` | Post-interview debrief: log questions asked, identify gaps, and anticipate next rounds. |
| `/career-ops cover` | Generate a tailored, high-signal cover letter for a specific job posting. |
| `/career-ops email` | Draft a professional application email or recruiter follow-up message. |
| `/career-ops contacto` | Find relevant team members on LinkedIn and draft warm intro outreach messages. |

---

### Career Strategy & Pipeline Intelligence

| Command | Description |
| :--- | :--- |
| `/career-ops patterns` | Analyze historical outcomes, interview advance rates, and rejection patterns. |
| `/career-ops upskill` | Aggregate and rank skill gaps detected across your evaluated job reports. |
| `/career-ops add` | Add a new project, paper, or role to your CV (fetch + preview + confirm). |
| `/career-ops expand` | Auto-discover and add missing competencies from profile links. |
| `/career-ops training` | Evaluate a course or certification against your North Star career goals. |
| `/career-ops project` | Evaluate a portfolio project idea against target role demand. |
| `/career-ops followup` | Check response deadlines and generate strategic follow-up reminders. |
| `/career-ops outcome` | Record final application outcome (Hired, Rejected, Withdrawn) and archive artifacts. |
| `/career-ops update` | Check and update career-ops system files with diff preview and compatibility checks. |

---

💡 Quick Start: Paste a job posting URL or job description text directly in this chat to run the full auto-pipeline!
```


---

## Context Loading by Mode

After determining the mode, load the necessary files before executing:

If `modes/_custom.md` exists, read it after `modes/_profile.md` and before the selected mode file. It contains user house rules and procedural preferences. It may override workflow/style defaults, but it never adds factual claims about the candidate.

### Modes that require `_shared.md` + their mode file

Read `modes/_shared.md` + `modes/_profile.md` (if exists) + `modes/_custom.md` (if exists) + `modes/{mode}.md`

Applies to: `auto-pipeline`, `oferta`, `ofertas`, `pdf`, `text`, `contacto`, `apply`, `pipeline`, `scan`, `batch`

### Standalone modes with profile and custom context

Read `modes/_profile.md` (if exists) + `modes/_custom.md` (if exists) + `modes/{mode}.md`

Applies to: `tracker`, `agent-inbox`, `deep`, `interview-prep`, `interview`, `regional/eu-swe`, `interview/plan`, `interview/practice`, `interview/debrief`, `latex`, `latex-tex`, `training`, `project`, `patterns`, `titles`, `upskill`, `followup`, `reply-watch`, `outcome`, `cover`, `email`, `add`, `offer-prep`, `discover`

### Modes delegated to subagent

For `scan`, `apply` (with Playwright), and `pipeline` (3+ URLs): launch as a worker/subagent with the content of `_shared.md` + `_profile.md` (if exists) + `_custom.md` (if exists) + `modes/{mode}.md` injected into the worker prompt. If your CLI exposes an `Agent(...)` primitive, the call looks like this:

```python
Agent(
  subagent_type="general-purpose",
  prompt="[output language directive]\n\n[content of modes/_shared.md]\n\n[content of modes/_profile.md if exists]\n\n[content of modes/_custom.md if exists]\n\n[content of modes/{mode}.md]\n\n[invocation-specific data]",
  description="career-ops {mode}"
)
```

Execute the instructions from the loaded mode file.
