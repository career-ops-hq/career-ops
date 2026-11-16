# 01 — Repository Analysis & Existing Capabilities

## 1. Executive Summary

Career-Ops is a local-first, AI-agnostic, human-in-the-loop CLI workspace designed to manage, evaluate, and accelerate technical and professional job searches. Rather than relying on a centralized SaaS platform, Career-Ops operates directly on local markdown, YAML, and JSON files on the candidate's machine, driven either interactively via AI coding CLIs (Claude Code, Antigravity, OpenCode, Codex, Pi, Qwen, Kimi, Grok) or headlessly via specialized Node.js (`.mjs`) scripts and local model runners (Gemini, OpenAI, Ollama).

This analysis examines the current implementation of Career-Ops (v1.40.0) to ground the proposed **AI Skill Proof Builder** contribution in existing infrastructure. By identifying existing code modules, data boundaries, and conventions, we ensure our architectural design maximizes reuse, respects the core tenets of Career-Ops, and introduces zero unnecessary dependencies or architectural divergence.

---

## 2. Core Architectural Principles of Career-Ops

Every capability in Career-Ops adheres to three settled architectural doctrines:

1. **Local-First & Privacy-Preserving:**
   - No remote backend server is required.
   - PII (resumes, contacts, applications, salary notes) remains strictly local on the candidate's machine.
   - SQLite exists solely as a derived read index (`data/applications.db`), never as a primary store. Human-readable, git-diffable markdown and TSV/YAML files remain the single source of truth.
2. **AI-Agnostic Execution:**
   - Prompts are defined as system modes in `modes/*.md` with shared scoring and procedural rules in `modes/_shared.md` and `modes/_writing.md`.
   - Standalone CLI utilities in Node.js (ESM, `.mjs`) provide zero-token deterministic operations and headless fallback scripts for various LLM APIs (`gemini-eval.mjs`, `openai-eval.mjs`, `ollama-eval.mjs`).
3. **Human-in-the-Loop & Confirm-Before-Write:**
   - Career-Ops prepares and evaluates; the human reviews, approves, and submits.
   - The tool strictly forbids silent modifications to user files. Adding skills, projects, or updating CV text requires explicit user gates (e.g., `add-entry.mjs`, `modes/expand.md`, `modes/master-profile.md`).

---

## 3. Data Contract: The Two-Layer Boundary

As formalized in `DATA_CONTRACT.md` and enforced by `updater-migration-tests.mjs`, Career-Ops maintains a strict boundary between two layers:

### 3.1 The System Layer (Auto-Updatable)
- **Ownership:** Maintained by upstream repository releases. Updated safely via `node update-system.mjs apply`.
- **Contents:**
  - `modes/*.md` (workflow prompts and evaluations).
  - Root scripts (`*.mjs`) and utility modules (`lib/*.mjs`, `utils/*.mjs`).
  - Pre-packaged templates (`templates/*`).
  - System test suites (`tests/**/*.test.mjs`).
  - System scaffolds (`data/.gitkeep`, `reports/.gitkeep`, `output/.gitkeep`, `jds/.gitkeep`).
- **Rule:** Never store user-specific configuration, personal data, or persistent application state here.

### 3.2 The User Layer (Never Overwritten by Updates)
- **Ownership:** Candidate-specific personal data and persistent state.
- **Contents:**
  - `cv.md` (candidate's primary resume in markdown).
  - `config/profile.yml` (identity, career targets, GitHub configuration, comp range).
  - `config/cv-facts.json` (allowlist of verified factual assertions).
  - `modes/_profile.md` (user archetypes, personal narrative, negotiation scripts).
  - `modes/_custom.md` (user house rules, procedural preferences).
  - `article-digest.md` (proof points, portfolio achievements, project deep dives).
  - `interview-prep/story-bank.md` (accumulated STAR+R stories).
  - `data/applications.md` (the canonical application tracker table).
  - `data/career-profile.yml` (source-backed Master Career Profile with quote-level verification).
  - `reports/` (individual job evaluation reports `reports/{NNN}-{company}-{date}.md`).
  - `jds/` (saved job descriptions).
  - `output/` (generated artifacts, PDFs, JSON summaries).
- **Rule:** The updater (`update-system.mjs`) will refuse to touch or replace any file registered in `USER_PATHS`.

### 3.3 Path Resolution via `path-resolver.mjs`
To allow portable execution, containerization, and Claude plugin isolation, the user layer root path is dynamically resolved via `path-resolver.mjs` following this precedence order:
1. `CAREER_OPS_ROOT` or `CAREER_OPS_DATA_DIR` environment variables.
2. `.career-ops-data` marker file in the repository root.
3. Claude Code plugin default (`~/career-ops-data`).
4. Repository root default.

---

## 4. Analysis of Relevant Existing Modules & Capabilities

We inspected the actual implementation files in Career-Ops to determine what can be directly reused for the **AI Skill Proof Builder**.

| Existing Capability | Actual File Location | Key Responsibilities & Implementation | Reusability for Skill Proof Builder |
| :--- | :--- | :--- | :--- |
| **Shared Skill Vocabulary & Canonical Extractor** | `skill-extract.mjs` | - Single source of truth for hard skills (#1896).<br>- Token list (`SKILL_TOKENS`) for languages, frameworks, databases, cloud, AI/ML, QA, observability, certifications, GTM.<br>- Case-sensitive handlers for boundary tokens (`Go`, `SAFe`, `Fine-tuning`).<br>- Canonicalization mapping (`CANONICAL`) resolving aliases (e.g. `k8s` → `Kubernetes`, `postgres` → `PostgreSQL`, `sklearn` → `scikit-learn`).<br>- Zero dependencies, pure regex-based execution. | **Directly Reusable.** Primary tokenizer and canonicalizer for Module A (Skill Extraction). |
| **JD Requirement & Skill Extractor** | `jd-skill-gap.mjs` | - Scans job descriptions to detect requirement sections using multilingual regex (`REQUIREMENT_HEADER_RE`, `QUALIFIED_REQUIREMENT_ARMS`).<br>- Extracts required skill tokens from bulleted lines and inline lists.<br>- Classifies skills against `cv.md` into three buckets: `existing`, `supportedByResume`, `gap`.<br>- Includes stopword filtering to prevent capitalized words from being misidentified as technical skills. | **Directly Reusable.** Ideal foundation for extracting target job requirements and comparing claimed vs required skills. |
| **GitHub Evidence Discovery** | `github-evidence.mjs` | - Uses authenticated `gh` CLI (falling back gracefully if missing).<br>- Collects user-authored PRs (merged, open, closed), authored commits on default branches, stars, visibility, fork detection.<br>- Supports reading READMEs for allowlisted repositories (`config/profile.yml` → `github_evidence.private_allowlist`).<br>- Bounded execution: max 1000 search results, max 8 PR titles/repo, max 6000 chars/README.<br>- Treats all fetched external content as untrusted data.<br>- Emits structured JSON and Markdown reports. | **Directly Reusable & Extensible.** Architectural blueprint for Module B (Evidence Collection). Can be reused for repository metadata, language stats, and README fetching. |
| **Competency Auto-Discovery Mode** | `modes/expand.md` | - Mode for discovering missing projects and competencies from public GitHub profiles, portfolios, and publications.<br>- Implements zero-key public GitHub REST API pagination (`api.github.com/users/<username>/repos`).<br>- Mandates 60 req/hr rate limit protection and fork suppression.<br>- Strictly requires payload identity and confirm-before-write gates via `add-entry.mjs`. | **Reference Pattern.** Establishes user interaction patterns for evidence-based competency expansion. |
| **Aggregate Skill-Gap Analyzer** | `upskill.mjs`, `modes/upskill.md` | - Parses evaluated reports across the tracker to produce aggregate gap heatmaps.<br>- Targeted mode (`--url-text`) compares single JD against `cv.md` / `config/profile.yml`.<br>- Calculates weighted gap scores: weight = `(5.0 - score)`.<br>- Identifies missing, partial, and close-call requirements. | **Reference Pattern.** Models skill prioritization and gap categorization. |
| **Master Career Profile** | `career-profile.mjs`, `lib/career-profile.mjs`, `modes/master-profile.md` | - Maintains verified candidate facts in `data/career-profile.yml`.<br>- Tracks source quote and exact line number from `cv.md`.<br>- Item-by-item review gate: nothing is written without verification.<br>- Rejects embellishment of metrics, ownership, dates, and outcomes. | **Directly Reusable.** Source-of-truth reference for candidate-claimed skills and project mappings. |
| **CV Fact Verification Gate** | `verify-cv-facts.mjs` | - Validates that CV facts and metrics match source records without hallucination or drift.<br>- Prevents fabrication of tooling, employers, dates, and ownership claims. | **Guiding Contract.** Enforces that skill claims must trace to authentic user evidence. |
| **Portfolio Project Evaluator** | `modes/project.md` | - Scores portfolio projects on 6 dimensions (Signal for target roles, Uniqueness, Demo ability, Metrics potential, Time to MVP, STAR potential).<br>- Evaluates project depth and interview readiness. | **Conceptual Foundation.** Scoring criteria directly inform the AI Evidence Evaluation Engine (Module D). |
| **Evaluation Reporting & Token Tracking** | `utils/token-tracker.mjs`, `utils/privacy-filter.mjs`, `gemini-eval.mjs`, `openai-eval.mjs` | - Tracking token usage across evaluation passes.<br>- Redacting sensitive PII before calling external AI providers.<br>- JSON schema extraction and structured evaluation output parsing. | **Directly Reusable.** Shared evaluation infrastructure for headless AI runners. |

---

## 5. What Career-Ops Already Does vs. The Missing Capability

### 5.1 What Career-Ops Already Does
1. **Keyword Presence & Gap Detection:** Identifies whether a skill required by a JD appears in `cv.md` (via `jd-skill-gap.mjs` and `upskill.mjs`).
2. **Metadata-Level GitHub Scanning:** Queries GitHub via `github-evidence.mjs` to list repositories, commit counts, and authored PR counts for `modes/expand.md`.
3. **Fact Verification:** Ensures bullet points in `cv.md` do not contradict `config/cv-facts.json` or `data/career-profile.yml`.
4. **General Project Scoring:** Evaluates project viability for a portfolio in `modes/project.md`.

### 5.2 What Is Genuinely Missing (The Skill Proof Gap)
- **No In-Depth Implementation Evidence:** Existing tools only verify *whether* a skill is listed in the CV or whether a repo contains PRs. They do **not** verify whether the candidate wrote meaningful code demonstrating that skill.
- **No Skill-to-Artifact Mapping:** No data structure connects `Skill: Python` to `Project: Fire-Detection-API` to specific source files, AST/dependency manifests, and architectural features.
- **No Qualitative Evidence Assessment:** The system does not classify evidence strength (e.g. distinguishing a hello-world clone from a production-grade distributed queue).
- **No Evidence-Driven Recommendations:** When evidence is thin (e.g., candidate claims "Kafka" but only imported it once without consumers or partition handling), Career-Ops currently offers no tactical recommendations on how to strengthen their repository proof points.

---

## 6. Architectural Constraints & Anti-Patterns to Avoid

To ensure upstream acceptance by Career-Ops maintainers, the AI Skill Proof Builder must avoid the following anti-patterns:

1. **No External Databases:** Do not introduce MongoDB, PostgreSQL, or vector databases. All canonical records must live in human-readable Markdown, YAML, or JSON files.
2. **No Monolithic Web Servers:** Career-Ops is an agentic, CLI-first tool. Do not create Express, NestJS, or FastAPI background daemons. Logic must be encapsulated in Node.js ESM modules (`.mjs`) and Markdown prompt modes (`modes/`).
3. **No Unbounded Code Execution:** Never execute, run, or dynamically evaluate untrusted code from GitHub repositories.
4. **No Heavy or Native Dependencies:** The project enforces zero-dependency, pure JavaScript where possible (relying on Node.js built-ins: `fs`, `path`, `crypto`, `child_process`). Do not install massive AST parsers or heavy external SDKs unless strictly necessary.
5. **No Token Exfiltration:** Never prompt the user for raw GitHub passwords or personal access tokens directly in conversational text. Rely on `gh auth` or safe local `.env` variables already supported by the project.
6. **No Silent CV Rewriting:** The tool must never directly alter `cv.md`. It generates a standalone Skill Proof Report and recommendation set for human review.

---

## 7. Conclusion

Career-Ops possesses a mature, highly reliable foundation for parsing JDs, extracting technical skill tokens, scanning GitHub metadata, and running deterministic and AI evaluations. The **AI Skill Proof Builder** will be built by composing these existing modules—specifically extending `skill-extract.mjs`, `jd-skill-gap.mjs`, and `github-evidence.mjs`—while introducing structured evidence mapping, deep source inspection, qualitative evidence grading, and targeted technical recommendations.
