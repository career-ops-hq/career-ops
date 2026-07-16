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
| `oferta.md` | `job` | Full A-G evaluation of a single offer |
| `ofertas.md` | `jobs` | Multi-job comparison |
| `auto-pipeline.md` | auto | Full automatic pipeline (evaluate + PDF + tracker) on a pasted JD/URL |
| `pipeline.md` | `pipeline` | Process the URL inbox (`data/pipeline.md`) |
| `scan.md` | `scan` | Portal scanner (job discovery) |
| `batch.md` | `batch` | Mass processing with headless workers |
| `apply.md` | `apply` | Live application assistant (form filling; never submits) |
| `pdf.md` | `pdf` | ATS-optimized PDF generation |
| `latex.md` | `latex` | LaTeX/Overleaf CV export |
| `cover.md` | `cover` | Cover letter generator |
| `email.md` | `email` | Application email drafts (draft-only) |
| `contacto.md` | `contacto` | LinkedIn outreach messages |
| `deep.md` | `deep` | Deep company-research prompt |
| `interview.md` | `interview` | Interactive profile & CV onboarding |
| `interview-prep.md` | `interview-prep` | Company-specific interview intelligence |
| `interview-redflag.md` | `interview-redflag` | Company red-flag detector |
| `offer-prep.md` | `offer-prep` | Contract reading companion (offer stage) |
| `followup.md` | `followup` | Follow-up cadence tracker |
| `reply-watch.md` | `reply-watch` | Classify employer replies, reconcile tracker |
| `tracker.md` | `tracker` | Applications tracker overview |
| `patterns.md` | `patterns` | Rejection pattern detector |
| `titles.md` | `titles` | Adjacent job-title suggestions |
| `training.md` | `training` | Training & course evaluation |
| `project.md` | `project` | Portfolio project evaluation |
| `add.md` | `add` | Add a project, paper, or role to the CV (confirm-before-write) |
| `agent-inbox.md` | `agent-inbox` | Queue requests for the next session |
| `update.md` | `update` | Interactive system update |

## Shared context and user customization

| File | Role |
|---|---|
| `_shared.md` | System context shared across modes: scoring system, global rules, source-of-truth boundary. System-owned — never put personal data here |
| `_profile.template.md` | Seed for your `modes/_profile.md` (archetypes, narrative, negotiation scripts) |
| `_custom.template.md` | Seed for your `modes/_custom.md` (house rules, procedural preferences) |

Your copies (`_profile.md`, `_custom.md`) are user-layer files: gitignored
and never touched by `update-system.mjs` (see
[DATA_CONTRACT.md](../DATA_CONTRACT.md)).

## Subdirectories

| Dir | Contents |
|---|---|
| `interview/` | Reusable interview skills: prep planner, practice interviewer, post-interview debrief (see [interview/README.md](interview/README.md)) |
| `heuristics/` | Shared candidate-facing writing heuristics loaded by other modes — `recruiter-side.md` governs PDF summaries, bullets, cover letters, form answers, and outreach |
| `regional/` | Market calibration modes — `eu-swe.md` calibrates applications for European SWE roles (advisory only) |
| `ar/ da/ de/ es/ fr/ hi/ id/ it/ ja/ ko/ pl/ pt/ ru/ tr/ ua/ zh/` | Language modes: native translations of the core modes with market-specific vocabulary; each has its own README |

## Conventions

- One file = one mode; the h1 is `# Mode: <name> — <purpose>`.
- Underscore prefix = shared context or template, not a routable mode.
- Language selection: explicit user request or `language.modes_dir` in
  `config/profile.yml` wins over JD-language detection (see `AGENTS.md`).
- Mode files are system-layer: edits belong upstream. User personalization
  goes in `_profile.md` / `_custom.md`, never in the mode files themselves.
