# Career-Ops -- AI Job Search Pipeline

## Origin

This system was built and used by [santifer](https://santifer.io) to evaluate 740+ job offers, generate 100+ tailored CVs, and land a Head of Applied AI role. The archetypes, scoring logic, negotiation scripts, and proof point structure all reflect his specific career search in AI/automation roles.

The portfolio that goes with this system is also open source: [cv-santiago](https://github.com/santifer/cv-santiago).

**It will work out of the box, but it's designed to be made yours.** If the archetypes don't match your career, the modes are in the wrong language, or the scoring doesn't fit your priorities -- just ask. You (AI Agent) can edit the user's files. The user says "change the archetypes to data engineering roles" and you do it. That's the whole point.

## Data Contract (CRITICAL)

There are two layers. Read `DATA_CONTRACT.md` for the full list.

**User Layer (NEVER auto-updated, personalization goes HERE):**
- `cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `article-digest.md`, `portals.yml`
- `data/*`, `reports/*`, `output/*`, `interview-prep/*`

**System Layer (auto-updatable, DON'T put user data here):**
- `modes/_shared.md`, `modes/oferta.md`, all other modes
- `CLAUDE.md`, `*.mjs` scripts, `dashboard/*`, `templates/*`, `batch/*`

**THE RULE: When the user asks to customize anything, write to the USER layer, NEVER to a system file — that is what survives `node update-system.mjs`.**
- **Profile / evaluation content** (archetypes, narrative, negotiation scripts, proof points, location policy, comp targets) → `modes/_profile.md` or `config/profile.yml`.
- **Procedural rules** (house rules, custom workflows, output preferences, "always/never do X" automations) → `modes/_custom.md` (create it from `modes/_custom.template.md` if missing).
- **NEVER** edit `modes/_shared.md`, `CLAUDE.md`, or any other system file for user-specific content — those get overwritten on update.

## Source-of-Truth Boundary (CRITICAL)

User-facing content (CV, cover letters, application emails, form answers, recruiter outreach, application form responses) is generated **exclusively** from these files plus statements the user makes directly in the current conversation:

- `cv.md`
- `article-digest.md`
- `config/profile.yml`
- `modes/_profile.md`
- `writing-samples/`
- `voice-dna.md` (voice/style only — governs *how* text reads, never introduces factual claims)
- `interview-prep/story-bank.md` and `interview-prep/{company}-{role}.md` (the user's own STAR stories and interview-prep notes — same trust level as `cv.md`; consumed by the `interview` and `apply`/`match-star` modes)

Anything not in this list is **out of scope for content generation**, including:

- Auto-memory at `~/.claude/projects/.../memory/` — see scope clarification below
- Any directory outside the career-ops project — for example, parent-directory repos containing the user's product code, sibling project directories, or other unrelated codebases on the same machine
- Cross-session inferences about the user's work that have not been written into one of the in-scope files
- Knowledge from other Claude Code projects on the same machine

**Rule from the original design (santifer's case study):** *"Keywords get reformulated, never fabricated."* Reorder, reframe, emphasise — but never invent. If a claim isn't backed by an in-scope file, ask the user. If they cannot or do not want to add it, the output goes without it. Silence on a topic is fine; manufactured detail is not.

**Authorship claims are non-negotiable.** Never claim the user authored a project, repo, library, tool, framework, or open-source artefact unless explicitly attributed to them in `cv.md` or `article-digest.md`. Tool-of-trade conflation (the user uses X → the user built X) is the most common fabrication pattern and is explicitly forbidden.

### Auto-memory scope (clarification, not exception)

The auto-memory layer at `~/.claude/projects/.../memory/` is reserved for **behavioural steering only**:

- User preferences (style, tone, formatting, communication cadence)
- Process rules and corrections (don't do X, always do Y)
- Operational state (active relationships, applied roles, observed patterns, outcome learnings)
- External references (where to find things in other systems)

Auto-memory **never** holds content claims about the user's work, technical accomplishments, authorship, or anything that would appear verbatim or near-verbatim in CV/cover output. If a fact belongs in user-facing content, it lives in the user-layer files, not in memory.

### Where rules live

Rules belong in files the harness reads automatically — `CLAUDE.md`, `AGENTS.md`, `modes/*.md`, `MEMORY.md`. Do not create sidecar documentation that requires manual loading. Reinforcement-without-enforcement decays.

## Update Check

On the first message of each session, run the update checker silently:

```bash
node update-system.mjs check
```

Parse the JSON output:
- `{"status": "update-available", "local": "1.0.0", "remote": "1.1.0", "changelog": "..."}` → tell the user:
  > "career-ops update available (v{local} → v{remote}). Your data (CV, profile, tracker, reports) will NOT be touched. Want me to update?"
  If yes → run `node update-system.mjs apply`. If no → run `node update-system.mjs dismiss`.
- `{"status": "up-to-date"}` → say nothing
- `{"status": "dismissed"}` → say nothing
- `{"status": "offline"}` → say nothing
- `{"status": "no-remote-version"}` → say nothing (checker reached GitHub but neither VERSION nor the latest release tag parsed as semver — treat as a silent non-failure, same as offline)

The user can also say "check for updates" or "update career-ops" at any time to force a check.
To rollback: `node update-system.mjs rollback`

## What is career-ops

AI-powered job search automation built on Claude Code: pipeline tracking, offer evaluation, CV generation, portal scanning, batch processing.

### Main Files

| File | Function |
|------|----------|
| `data/applications.md` | Application tracker |
| `data/pipeline.md` | Inbox of pending URLs |
| `data/scan-history.tsv` | Scanner dedup history |
| `portals.yml` | Query and company config |
| `templates/cv-template.html` | HTML template for CVs |
| `templates/cv-template.tex` | LaTeX/Overleaf template for CVs |
| `generate-pdf.mjs` | Playwright: HTML to PDF |
| `generate-latex.mjs` | LaTeX CV validator + pdflatex compiler |
| `article-digest.md` | Compact proof points from portfolio (optional) |
| `interview-prep/story-bank.md` | Accumulated STAR+R stories across evaluations |
| `interview-prep/{company}-{role}.md` | Company-specific interview intel reports |
| `analyze-patterns.mjs` | Pattern analysis script (JSON output). Includes ATS channel analysis (per-vendor advance rate; motivated by Bommasani et al., Algorithmic Monocultures in Hiring, FAccT 2026). |
| `stats.mjs` | Lifetime pipeline stats aggregator (JSON or `--summary`) — tracker roll-up, canonical `ever*` funnel, lifetime scan totals, portal coverage, follow-up compliance, scan-run trends |
| `data/scan-runs.tsv` | Per-run scan counters (appended by `scan.mjs`, read by `stats.mjs`) |
| `followup-cadence.mjs` | Follow-up cadence calculator (JSON output) |
| `followup-seed.mjs` | Seeds `data/follow-ups.md` with a pinned first follow-up date when a row turns Applied (JSON output) |
| `data/follow-ups.md` | Follow-up history tracker |
| `scan.mjs` | Zero-token portal scanner — hits Greenhouse/Ashby/Lever APIs directly, zero LLM cost |
| `check-liveness.mjs` | Job posting liveness checker |
| `liveness-core.mjs` | Shared liveness logic (expired signals win over generic Apply text) |
| `reports/` | Evaluation reports (format: `{###}-{company-slug}-{YYYY-MM-DD}.md`). Blocks A-F + G (Posting Legitimacy), plus `## Machine Summary` YAML for downstream scripts. Header includes `**Legitimacy:** {tier}`. |

### OpenCode, Antigravity CLI & Grok Build CLI Commands

[OpenCode](https://opencode.ai), Antigravity CLI, and Grok Build CLI natively support the open agent skill standard (`agentskills.io`).

Instead of registering individual `.toml` files for every slash command, all subcommands are routed through the single unified skill defined in `.agents/skills/career-ops/SKILL.md`.

You can invoke the command center or any of its modes directly within your CLI:

* `/career-ops` (Shows the Command Center menu)
* `/career-ops {JD text or URL}` (Runs the auto-evaluation pipeline)
* `/career-ops [subcommand]` (Runs a specific subcommand)

#### Subcommands:
* `pipeline` — Process pending URLs from inbox
* `scan` — Scan job portals for new offers
* `tracker` — Show application status overview
* `pdf` — Generate ATS-optimized CV PDF
* `latex` — Export CV as LaTeX/Overleaf .tex
* `cover` — Generate cover letter
* `email` — Draft formal application email only; never sends, submits, or clicks
* `interview-prep` — Generate interview preparation guide
* `interview` — Onboarding/on-demand interview
* `contacto` — Generate LinkedIn outreach message
* `deep` — Execute deep company research
* `training` — Evaluate course/cert against North Star
* `project` — Evaluate portfolio project idea
* `batch` — Run parallel batch evaluations
* `patterns` — Analyze rejection patterns
* `followup` — Update and calculate follow-ups
* `update` — Update system files

All `modes/*` files and prompt contexts are shared across Claude Code, OpenCode, Antigravity CLI, and Grok Build CLI. `GEMINI.md` remains only as a legacy no-op guard so Antigravity does not duplicate the full project instructions.

### First Run — Onboarding (IMPORTANT)

**Before doing ANYTHING else, check if the system is set up.** On the first message of each session, run the cold-start check — one deterministic source of truth (this doc and `doctor.mjs` share the same prerequisite list, so they can never drift):

```bash
node doctor.mjs --json
```

Output: `{"onboardingNeeded": <bool>, "missing": [...], "warnings": [...], "autoCopied": [...]}`, where `missing` lists whichever of `cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml` are absent. `warnings` is reserved for non-blocking setup signals, and `autoCopied` lists user customization files (`modes/_profile.md` or `modes/_custom.md`) that `doctor.mjs` automatically copied from their `.template.md` equivalents during the check.

**If `onboardingNeeded` is true (any of `cv.md` / `config/profile.yml` / `modes/_profile.md` / `portals.yml` is missing), enter onboarding mode.** Do NOT proceed with evaluations, scans, or any other mode until the basics are in place. Guide the user step by step:

#### Step 1: CV (required)
If `cv.md` is missing, ask:
> "I don't have your CV yet. You can either:
> 1. Paste your CV here and I'll convert it to markdown
> 2. Paste your LinkedIn URL and I'll extract the key info
> 3. Tell me about your experience and I'll draft a CV for you
>
> Which do you prefer?"

Create `cv.md` from whatever they provide. Make it clean markdown with standard sections (Summary, Experience, Projects, Education, Skills).

#### Step 2: Profile (required)
If `config/profile.yml` is missing, copy from `config/profile.example.yml` and then ask:
> "I need a few details to personalize the system:
> - Your full name and email
> - Your location and timezone
> - What roles are you targeting? (e.g., 'Senior Backend Engineer', 'AI Product Manager')
> - Your salary target range
>
> I'll set everything up for you."

Fill in `config/profile.yml` with their answers. For archetypes and targeting narrative, store the user-specific mapping in `modes/_profile.md` or `config/profile.yml` rather than editing `modes/_shared.md`.

#### Step 3: Portals (recommended)
If `portals.yml` is missing:
> "I'll set up the job scanner with 45+ pre-configured companies. Want me to customize the search keywords for your target roles?"

Copy `templates/portals.example.yml` → `portals.yml`. If they gave target roles in Step 2, update `title_filter.positive` to match.

#### Step 4: Tracker
If `data/applications.md` doesn't exist, create it:
```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
```

#### Step 5: Get to know the user (important for quality)

After the basics are set up, proactively ask for more context. The more you know, the better your evaluations will be:

> "The basics are ready. But the system works much better when it knows you well. Can you tell me more about:
> - What makes you unique? What's your 'superpower' that other candidates don't have?
> - What kind of work excites you? What drains you?
> - Any deal-breakers? (e.g., no on-site, no startups under 20 people, no Java shops)
> - Your best professional achievement — the one you'd lead with in an interview
> - Any projects, articles, or case studies you've published?
>
> The more context you give me, the better I filter. Think of it as onboarding a recruiter — the first week I need to learn about you, then I become invaluable."

Store any insights the user shares in `config/profile.yml` (under narrative), `modes/_profile.md`, or in `article-digest.md` if they share proof points. Do not put user-specific archetypes or framing into `modes/_shared.md`.

**After every evaluation, learn.** If the user says "this score is too high, I wouldn't apply here" or "you missed that I have experience in X", update your understanding in `modes/_profile.md`, `config/profile.yml`, or `article-digest.md`. The system should get smarter with every interaction without putting personalization into system-layer files.

#### Step 6: Ready
Once all files exist, confirm:
> "You're all set! You can now:
> - Paste a job URL to evaluate it
> - Run `/career-ops scan` to search portals
> - Run `/career-ops` to see all commands
>
> Everything is customizable — just ask me to change anything.
>
> Tip: Having a personal portfolio dramatically improves your job search. If you don't have one yet, the author's portfolio is also open source: github.com/santifer/cv-santiago — feel free to fork it and make it yours."

Then suggest automation:
> "Want me to scan for new offers automatically? I can set up a recurring scan every few days so you don't miss anything. Just say 'scan every 3 days' and I'll configure it."

If the user accepts, use the `/loop` or `/schedule` skill (if available) to set up a recurring `/career-ops scan`. If those aren't available, suggest adding a cron job or remind them to run `/career-ops scan` periodically.

### Personalization

This system is designed to be customized by YOU (AI Agent). When the user asks you to change archetypes, translate modes, adjust scoring, add companies, or modify negotiation scripts -- do it directly. You read the same files you use, so you know exactly what to edit.

**Common customization requests:**
- "Change the archetypes to [backend/frontend/data/devops] roles" → edit `modes/_profile.md` or `config/profile.yml`
- "Translate the modes to English" → edit all files in `modes/`
- "Add these companies to my portals" → edit `portals.yml`
- "Update my profile" → edit `config/profile.yml`
- "Change the CV template design" → edit `templates/cv-template.html`
- "Adjust the scoring weights" → edit `modes/_profile.md` for user-specific weighting, or edit `modes/_shared.md` and `batch/batch-prompt.md` only when changing the shared system defaults for everyone

### Language Modes

Default modes are in `modes/` (English). Language-specific modes live in `modes/{lang}/` — each has `_shared.md`, the eval/apply/`pipeline.md` modes, and a `README.md` documenting that market's vocabulary:

| Language | Dir | Markets |
|----------|-----|---------|
| German | `modes/de/` | DACH (Germany, Austria, Switzerland) |
| French | `modes/fr/` | France, Belgium, Switzerland, Luxembourg, Quebec |
| Japanese | `modes/ja/` | Japan |

**When to use a `{lang}` mode** — if any holds: the user says "use {lang} modes"; `config/profile.yml` sets `language.modes_dir: modes/{lang}`; or you detect a {lang} JD (then suggest switching). Read from `modes/{lang}/` instead of `modes/`.

**When NOT to:** if the user applies to English-language roles — even at French, German, or Japanese companies — use the default English modes.

### Skill Modes

| If the user... | Mode |
|----------------|------|
| Pastes JD or URL | auto-pipeline (evaluate + report + PDF + tracker) |
| Asks to evaluate offer | `oferta` |
| Asks to compare offers | `ofertas` |
| Wants LinkedIn outreach | `contacto` |
| Wants a formal application email | `email` — draft-only; never sends, submits, or clicks anything |
| Asks for company research | `deep` |
| Preps for interview at specific company | `interview-prep` |
| Wants interactive profile/CV onboarding | `interview` |
| Wants a time-blocked prep plan for an upcoming interview | `interview/plan` |
| Wants to run practice interview questions with feedback | `interview/practice` |
| Wants to debrief after a real interview and close gaps | `interview/debrief` |
| Wants to generate CV/PDF | `pdf` |
| Evaluates a course/cert | `training` |
| Evaluates portfolio project | `project` |
| Asks about application status | `tracker` |
| Fills out application form | `apply` |
| Searches for new offers | `scan` |
| Processes pending URLs | `pipeline` |
| Batch processes offers | `batch` |
| Asks about rejection patterns, wants to improve targeting, or wants to match interview answers to best-fit roles | `patterns` |
| Asks about follow-ups or application cadence | `followup` |

### CV Source of Truth

- `cv.md` in project root is the canonical CV
- `article-digest.md` has detailed proof points (optional)
- **NEVER hardcode metrics** -- read them from these files at evaluation time

---

## Ethical Use -- CRITICAL

**This system is designed for quality, not quantity.** The goal is to help the user find and apply to roles where there is a genuine match -- not to spam companies with mass applications.

- **NEVER submit an application without the user reviewing it first.** Fill forms, draft answers, generate PDFs -- but always STOP before clicking Submit/Send/Apply. The user makes the final call.
- **Strongly discourage low-fit applications.** If a score is below 4.0/5, explicitly recommend against applying. The user's time and the recruiter's time are both valuable. Only proceed if the user has a specific reason to override the score.
- **Quality over speed.** A well-targeted application to 5 companies beats a generic blast to 50. Guide the user toward fewer, better applications.
- **Respect recruiters' time.** Every application a human reads costs someone's attention. Only send what's worth reading.

---

## Offer Verification -- MANDATORY

Verify a posting is still live before applying — using the cheapest check that works (a false "expired" is worse than a slow check: it makes the user miss a real job):

1. **ATS-hosted postings (Greenhouse, Lever, ...) — API first, zero tokens:** run `node check-liveness.mjs <url>`. It hits the posting's public ATS JSON API directly (no browser, no tokens) and reports `active`/`expired`, falling back to a browser only when the API is inconclusive. A definitive `expired` from the API is authoritative.
2. **Non-ATS pages, or when the API is inconclusive — Playwright:** `browser_navigate` to the URL + `browser_snapshot`. Only footer/navbar without JD = closed; title + description + Apply = active.

**NEVER decide liveness from a bare WebSearch/WebFetch snippet** — use `check-liveness.mjs` (which does the API rung) or Playwright.

**Exception for batch workers (`claude -p`):** Playwright is unavailable in headless pipe mode. The API rung above still works for ATS postings; for non-ATS pages use WebFetch as a fallback and mark the report header `**Verification:** unconfirmed (batch mode)`.

---

## CI/CD and Quality

- **GitHub Actions** run on every PR: `test-all.mjs` (63+ checks), auto-labeler (risk-based: 🔴 core-architecture, ⚠️ agent-behavior, 📄 docs), welcome bot for first-time contributors
- **Branch protection** on `main`: status checks must pass before merge. No direct pushes to main (except admin bypass).
- **Dependabot** monitors npm, Go modules, and GitHub Actions for security updates
- **Contributing process**: issue first → discussion → PR with linked issue → CI passes → maintainer review → merge

## Community and Governance

- **Code of Conduct**: Contributor Covenant 2.1 with enforcement actions (see `CODE_OF_CONDUCT.md`)
- **Governance**: BDFL model with contributor ladder — Participant → Contributor → Triager → Reviewer → Maintainer (see `GOVERNANCE.md`)
- **Security**: private vulnerability reporting via email (see `SECURITY.md`)
- **Support**: help questions go to Discord/Discussions, not issues (see `SUPPORT.md`)
- **Discord**: https://discord.gg/8pRpHETxa4

## Stack and Conventions

- Node.js (mjs modules), Playwright (PDF + scraping), YAML (config), HTML/CSS (template), Markdown (data), Canva MCP (optional visual CV)
- Scripts in `.mjs`, configuration in YAML
- Output in `output/` (gitignored), Reports in `reports/`
- JDs in `jds/` (referenced as `local:jds/{file}` in pipeline.md)
- Batch in `batch/` (gitignored except scripts and prompt)
- Report numbering: sequential 3-digit zero-padded, max existing + 1
- **RULE: After each batch of evaluations, run `node merge-tracker.mjs`** to merge tracker additions and avoid duplications.
- **RULE: NEVER create new entries in applications.md if company+role already exists.** Update the existing entry.

### TSV Format for Tracker Additions

Write one TSV file per evaluation to `batch/tracker-additions/{num}-{company-slug}.tsv`. Single line, 9 tab-separated columns:

```
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{note}
```

**Column order (IMPORTANT -- status BEFORE score):**
1. `num` -- sequential number (integer)
2. `date` -- YYYY-MM-DD
3. `company` -- short company name
4. `role` -- job title
5. `status` -- canonical status (e.g., `Evaluated`)
6. `score` -- format `X.X/5` (e.g., `4.2/5`)
7. `pdf` -- `✅` or `❌`
8. `report` -- markdown link, always written **root-relative**: `[num](reports/...)`
9. `notes` -- one-line summary

**Note:** In applications.md, score comes BEFORE status. The merge script handles this column swap automatically.

**Report link normalization:** The TSV always carries a **root-relative** `[num](reports/...)` link. `merge-tracker.mjs` rewrites it so the link is relative to the tracker file's own directory before writing it into the tracker — `../reports/...` when the tracker is at `data/applications.md`, or `reports/...` at the root layout. This keeps links clickable from the tracker (markdown links resolve relative to the file that contains them). Normalization is idempotent. To fix links in an existing tracker, run `node merge-tracker.mjs --migrate` (see #760).

### Pipeline Integrity

1. **NEVER edit applications.md to ADD new entries** -- Write TSV in `batch/tracker-additions/` and `merge-tracker.mjs` handles the merge.
2. **YES you can edit applications.md to UPDATE status/notes of existing entries.**
3. All reports MUST include `**URL:**` in the header (between Score and PDF). Include `**Legitimacy:** {tier}` (see Block G in `modes/oferta.md`).
4. All statuses MUST be canonical (see `templates/states.yml`).
5. Health check: `node verify-pipeline.mjs`
6. Normalize statuses: `node normalize-statuses.mjs`
7. Dedup: `node dedup-tracker.mjs`

### Canonical States (applications.md)

**Source of truth (full descriptions + aliases):** `templates/states.yml`. The 8 canonical states (use exactly one): `Evaluated` · `Applied` · `Responded` · `Interview` · `Offer` · `Rejected` · `Discarded` · `SKIP`.

**RULES:** no markdown bold (`**`), no dates (those go in the date column), no extra text (use the notes column) in the status field.
@AGENTS.md
<!-- Add anything Claude Code specific that other agents don't need -->
