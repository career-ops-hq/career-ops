# Career-ops Web UI & Dashboard Documentation

The official local-first Next.js web application provides an intuitive graphical command center for the Career-ops pipeline, allowing you to evaluate jobs, manage offers, track applications, and coordinate AI coding CLI tasks without needing to memorize CLI commands.

---

## Getting Started

To launch the local web server and open the browser dashboard:

```bash
npm run ui
```

The server starts locally on `http://localhost:3000` (or the next available port) and opens your default browser.

---

## Architecture & Data Contract Compliance

The Web UI is strictly an additional interface to the existing Career-ops engine and preserves all Data Contract rules:

- **User-Layer Protection**: All writes to user files (`cv.md`, `config/profile.yml`, `data/applications.md`, `data/agent-inbox.md`, `data/salary-observations.tsv`) use atomic write semantics with `.bak` safety snapshots.
- **Human-in-the-loop**: The UI never auto-submits external applications or sends emails without user confirmation.
- **CLI Agnostic**: Works seamlessly alongside your chosen CLI runtime (Claude Code, Antigravity CLI `agy`, OpenAI Codex, OpenCode, Gemini CLI, Grok Build, Copilot, Qwen).

---

## Route & Navigation Guide

### 1. Core Hub
- **`/` (Today)**: Real-time decision stream, daily job recommendations, pending follow-ups, and pipeline velocity metrics.
- **`/cv` (CV & Resume)**: Visual markdown CV editor, local PDF/DOCX parser, and zero-token ATS fact validator.
- **`/profile` (Profile & Target)**: Candidate identity fields, target role archetypes, salary target range, and remote/location policies synced to `config/profile.yml`.
- **`/jobs` (Job Evaluations)**: Structured evaluation reports (Blocks A–G, Legitimacy Tier, Match Score).
- **`/explore` (Live Discovery)**: Multi-portal job hunter with reverse ATS keyword scanners and AI exploration traces.
- **`/pipeline` (Inbox Pipeline)**: Queue of unreviewed job posting URLs (`data/pipeline.md`).
- **`/tracker` (Applications Kanban)**: Canonical status lifecycle tracker synced with `data/applications.md`.
- **`/documents` (Artifacts Hub)**: Access to generated tailored CVs, cover letters, STAR stories, and report archives.

### 2. Operations & Negotiation
- **`/offers` (Offers & Compensation Modeler)**:
  - **Live Offer Pipeline**: Track offer statuses and decision deadlines.
  - **Interactive Total Comp Modeler**: Real-time breakdown of Base, Bonus %, Annual Equity / RSUs, Sign-on bonus, and monthly take-home.
  - **Target Gap Gauge**: Dynamic delta vs your stated target range in `config/profile.yml`.
  - **AI Negotiation Studio**: Generate anchored counter-offer letters tailored by strategy (Base counter, Competing offer, Geo parity, Equity pivot) and tone.
  - **Salary Observations Ledger**: Append-only log of market compensation data points (`data/salary-observations.tsv`).
- **`/interviews` (Interview Command Center)**: STAR question bank, company intel, and interview round prep notes.
- **`/contacts` (Recruiter & HM Phonebook)**: Contact ledger with vCard export.
- **`/companies` (Company Intelligence)**: Funding stage, tech stack, and interview friction history.
- **`/followups` (Follow-up Tracker)**: Pinned cadence reminders and outreach draft generation.
- **`/replies` (Email Reply Matcher)**: Inbound recruiter reply parser.

### 3. Growth & AI System
- **`/inbox` (Agent Inbox Queue)**:
  - Durable task queue drained by your AI Coding CLI at session start (`data/agent-inbox.md`).
  - Queue evaluation requests, CV tailoring tasks, and portal scans with one-click presets.
  - Real-time resolution annotations and CLI command copy helpers.
- **`/analytics` (Pipeline Funnel Analytics)**: Conversion velocity, ATS pass rates, and latency metrics.
- **`/upskill` (Skill Gap Analysis)**: Real-time gap analysis comparing market JD requirements against your CV.
- **`/plugins` (Integration Manager)**: Enable or configure plugins (Notion, Gmail, Apify, H1B sponsor).
- **`/diagnostics` & `/config`**: AI CLI connectivity status, system health checks, and engine configuration.

---

## API Endpoints Reference

| Endpoint | Method | Purpose |
|---|:---:|---|
| `/api/cv` | `GET`, `POST` | Reads and updates `cv.md` with atomic backup and `profile.yml` sync. |
| `/api/profile` | `GET`, `POST` | Merges candidate and target settings into `config/profile.yml`. |
| `/api/inbox` | `GET`, `POST` | Manages queued agent requests in `data/agent-inbox.md`. |
| `/api/offers` | `GET`, `POST` | Retrieves active tracker offers and logs compensation observations to TSV. |
| `/api/tracker` | `GET`, `POST` | Reads and writes application tracker rows. |
| `/api/status` | `POST` | Updates application statuses using canonical transition rules. |
| `/api/clis` | `GET` | Detects installed local AI coding CLIs and permissions. |
| `/api/doctor` | `GET` | Runs system diagnostics and cold-start onboarding checks. |

---

## Development & Testing

```bash
# Typecheck Next.js application
npm --prefix web run typecheck

# Run test suites (750 unit and integration tests)
npm --prefix web test

# Production build
npm --prefix web run build
```
