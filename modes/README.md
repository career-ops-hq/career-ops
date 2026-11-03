# modes/

The "brain" of career-ops: Markdown prompt files executed by whatever AI
coding CLI you use.

## Purpose

Each mode file defines one workflow (evaluate, apply, scan, ...). The agent
reads the mode plus the shared context and your user files, then executes it.
Routing — which user request triggers which mode — lives in the Skill Modes
table in `AGENTS.md` (mirrored in `CLAUDE.md`).

## Mode catalog

| File | Mode | Purpose |
|---|---|---|
| `oferta.md` | `oferta` | Full evaluation of a single offer: Blocks A-G, plus Block H (draft application answers) for high-scoring offers |
| `ofertas.md` | `ofertas` | Multi-job comparison |
| `auto-pipeline.md` | (paste a JD/URL) | Full automatic pipeline (evaluate + PDF + tracker) on a pasted JD/URL |
| `pipeline.md` | `pipeline` | Process the URL inbox (`data/pipeline.md`) |
| `scan.md` | `scan` | Portal scanner (job discovery) |
| `discover.md` | `discover` | Resolve company names to scannable ATS boards for `portals.yml` |
| `triage.md` | `triage` | Fast first-pass quick score before full evaluation |
| `batch.md` | `batch` | Mass processing with headless workers |
| `apply.md` | `apply` | Live application assistant (form filling; never submits) |
| `pdf.md` | `pdf` | ATS-optimized PDF generation |
| `ats.md` | `ats` | ATS-friendliness check of a generated CV (parseability score + issues) |
| `latex.md` | `latex` | LaTeX/Overleaf CV export |
| `latex-tex.md` | `latex-tex` | Tailor your own hand-maintained `.tex` CV in place (opt-in) |
| `text.md` | `text` | Tailored markdown CV (no PDF) |
| `cover.md` | `cover` | Cover letter generator |
| `email.md` | `email` | Application email drafts (draft-only) |
| `contacto.md` | `contacto` | LinkedIn outreach messages |
| `deep.md` | `deep` | Deep company-research prompt |
| `interview.md` | `interview` | Interactive profile & CV onboarding |
| `master-profile.md` | `master-profile` | Source-backed Master Career Profile import and review |
| `intake.md` | `intake` | Build or enrich the profile from documents in `documents/` (confirm-before-write) |
| `interview-prep.md` | `interview-prep` | Company-specific interview intelligence |
| `interview-redflag.md` | `interview-redflag` | Company red-flag detector |
| `offer-prep.md` | `offer-prep` | Contract reading companion (offer stage) |
| `followup.md` | `followup` | Follow-up cadence tracker |
| `reply-watch.md` | `reply-watch` | Classify employer replies, reconcile tracker |
| `outcome.md` | `outcome` | Record application outcome & archive artifacts |
| `tracker.md` | `tracker` | Applications tracker overview |
| `patterns.md` | `patterns` | Rejection pattern detector |
| `calibrate.md` | `calibrate` | Advisory report: do your evaluation scores predict your real outcomes? Reads `/outcome` data; never changes scoring |
| `titles.md` | `titles` | Adjacent job-title suggestions |
| `upskill.md` | `upskill` | Skill-gap analysis across the evaluated pipeline |
| `training.md` | `training` | Training & course evaluation |
| `project.md` | `project` | Portfolio project evaluation |
| `add.md` | `add` | Add a project, paper, or role to the CV (confirm-before-write) |
| `expand.md` | `expand` | Discover competencies missing from the CV (confirm-before-write) |
| `agent-inbox.md` | `agent-inbox` (alias `inbox`) | Queue requests for the next session |
| `retro.md` | `retro` | Turn this session's corrections into proposed rules for `_custom.md` / `_profile.md` |
| `update.md` | `update` | Interactive system update |

## Shared context and user customization

| File | Role |
|---|---|
| `_shared.md` | System context shared across modes: scoring system, global rules, source-of-truth boundary. System-owned — never put personal data here |
| `_profile.template.md` | Seed for your `modes/_profile.md` (archetypes, narrative, negotiation scripts) |
| `_custom.template.md` | Seed for your `modes/_custom.md` (house rules, procedural preferences) |
| `_brief.template.md` | Seed for your `modes/_brief.md` (compact context for `triage`) |
| `_writing.md` | Shared writing guidance (Voice DNA, writing style, ATS rules) loaded by modes that write candidate-facing prose |

Your copies (`_profile.md`, `_custom.md`, `_brief.md`) are user-layer files: gitignored
and never touched by `update-system.mjs` (see
[DATA_CONTRACT.md](../DATA_CONTRACT.md)).

## Subdirectories

| Dir | Contents |
|---|---|
| `interview/` | Reusable interview skills: prep planner, practice interviewer, post-interview debrief (see [interview/README.md](interview/README.md)) |
| `heuristics/` | Shared candidate-facing writing heuristics loaded by other modes — `recruiter-side.md` governs PDF summaries, bullets, cover letters, form answers, and outreach |
| `oferta-signals/` | Block G posting-legitimacy signal checks that `oferta.md` reads on demand, not routable modes |
| `pdf/` | Opt-in passes inside the `pdf` flow, not routable modes — `hm-audit.md` is the hiring-manager read of a tailored CV, run between the fact gate and PDF render when `--hm-audit` is passed |
| `regional/` | Market calibration modes — `eu-swe.md` (routed as `eu-swe`) calibrates applications for European SWE roles (advisory only) |
| `ar/ da/ de/ es/ fr/ hi/ id/ it/ ja/ ko/ nl/ pl/ pt/ ru/ sg/ tr/ ua/ vi/ zh/ zh-TW/` | Language and market modes: the core modes translated or adapted for a market (`sg/` is English for Singapore), with market-specific vocabulary; each has its own README |

## Conventions

- One file = one mode; the h1 is `# Mode: <name> — <purpose>`.
- Underscore prefix = shared context or template, not a routable mode.
- Language selection: explicit user request or `language.modes_dir` in
  `config/profile.yml` wins over JD-language detection (see `AGENTS.md`).
- Mode files are system-layer: edits belong upstream. User personalization
  goes in `_profile.md` / `_custom.md`, never in the mode files themselves.
