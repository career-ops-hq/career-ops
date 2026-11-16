# [Feature Proposal]: AI Skill Proof Builder — Audit Technical Skills Against Repository Evidence

> **Submission Target:** GitHub Issue / Discussions (`career-ops-hq/career-ops`)  
> **Area:** Evaluation / Scoring / Skills  
> **Author:** Contributor  
> **Status:** Ready for Maintainer Review  

---

## 1. Feature Title
**AI Skill Proof Builder — Audit Technical Skills Against Repository Evidence**

---

## 2. Problem Statement
Technical candidates frequently list dozens of programming languages, frameworks, databases, and cloud tools on their resumes ("Python, PostgreSQL, Kubernetes, React, Kafka, Docker"). However, hiring managers and technical interviewers screen for **practical implementation evidence**, not keyword density. 

Currently, candidates face an evidence gap:
- A repository named `kafka-demo` or a single `import torch` in a 10-line script is not proof of production capability.
- Candidates often fail to showcase deep architectural work already present in their public codebases.
- When screened out or rejected, candidates receive no feedback on whether their public proof points were considered weak or nonexistent.

The proposed feature establishes an audit-grade, verifiable relationship:
$$\text{Job Requirement (JD)} \longrightarrow \text{Candidate Skill (CV)} \longrightarrow \text{Supporting Evidence (GitHub)} \longrightarrow \text{Evidence Assessment (4 Tiers)} \longrightarrow \text{Actionable Recommendations}$$

---

## 3. Current Limitations in Career-Ops
Career-Ops currently excels at:
1. Keyword and requirement gap detection between JDs and CV text (`jd-skill-gap.mjs`, `upskill.mjs`).
2. Activity-level GitHub counting (authored PRs and commits for `modes/expand.md` via `github-evidence.mjs`).
3. Internal CV fact consistency checking (`verify-cv-facts.mjs`).
4. General portfolio project scoring (`modes/project.md`).

**What is missing:**
Career-Ops currently has **no capability to inspect technical implementation artifacts** or evaluate whether a skill claimed in `cv.md` is supported by authentic code. It can tell a candidate that "PostgreSQL" is mentioned in their CV, but cannot tell them whether their public GitHub repositories contain schema migrations, relational models, or connection pooling.

---

## 4. Proposed Solution
Introduce the **AI Skill Proof Builder**, consisting of an agentic mode (`modes/skill-proof.md`) for AI-assisted qualitative evaluation and a companion standalone deterministic CLI utility (`node skill-proof.mjs`) that:
1. Extracts required skills from a target JD supplied as a local file or pasted text (`extractJdSkills` from `jd-skill-gap.mjs`) and claimed skills from `cv.md` / `config/profile.yml` (`extractSkills` from `skill-extract.mjs`). Remote URL fetching is deferred to future work to keep MVP input strictly local and safe.
2. Discovers accessible candidate GitHub repositories and inspects dependency manifests (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`), configuration files (`Dockerfile`, `docker-compose.yml`), sanitized README documentation (max 6,000 chars), automated tests, and bounded static source code files.
3. Constructs a Many-to-Many Skill-Evidence Mapping matrix separating artifacts into distinct categories (`dependency_manifests`, `configuration_files`, `source_code`, `tests`, `documentation`).
4. Evaluates evidence depth using a calibrated 4-tier rubric (`STRONG_EVIDENCE`, `PARTIAL_EVIDENCE`, `NO_EVIDENCE_FOUND`, `UNABLE_TO_VERIFY`).
5. Generates concrete, practical technical upgrade recommendations for weak/missing skills.
6. Emits a structured Markdown and JSON audit report in the User Layer (`data/skill-proof/`) without modifying `cv.md`.

---

## 5. How the Feature Will Work

### A. Interactive Agent Workflow (`modes/skill-proof.md`)
In an AI coding CLI (Claude Code, Antigravity, OpenCode, Codex, Pi, Qwen):

*(Illustrative proposed agent prompt — syntax subject to maintainer router convention)*
```bash
/career-ops skill-proof jds/acme.md
# Or by pasting verbatim JD text directly into the agent prompt
```
1. Agent reads `cv.md`, `config/profile.yml`, and the target JD (from local file or pasted text).
2. Agent normalizes skills via `skill-extract.mjs` and presents a comparison table.
3. Agent gathers evidence (manifests, config files, READMEs, bounded source and test excerpts) using candidate's GitHub handle or local `gh` CLI.
4. Agent executes qualitative evaluation across the 4 discrete tiers (`STRONG_EVIDENCE`, `PARTIAL_EVIDENCE`, `NO_EVIDENCE_FOUND`, `UNABLE_TO_VERIFY`) using structured prompt instructions with strict XML injection containment.
5. Agent produces validated structured JSON matching the `skill-proof-report.v1` schema.
6. The shared report generator (`lib/skill-proof-reporter.mjs`) consumes this validated JSON payload, formats the canonical Markdown and JSON reports in `data/skill-proof/`, and the agent offers to help draft concrete implementation improvements.

### B. Standalone CLI Execution (`skill-proof.mjs`)
A local-first, zero-LLM deterministic utility that runs without requiring an AI model or external API keys:

*(Illustrative proposed CLI command — feature not yet implemented)*
```bash
# Evaluate against a local saved JD file using deterministic heuristic scoring
node skill-proof.mjs --jd jds/acme.md --github janesmith --json

# Targeted evaluation of a single skill against local or cloned repository
node skill-proof.mjs --skill "PostgreSQL" --repo "janesmith/inventory-api" --summary

# Hermetic self-test
node skill-proof.mjs --self-test
```
The standalone script deterministically extracts skills, collects evidence, maps artifacts, computes a heuristic assessment tier, and emits validated JSON consumed by the shared report generator to write the final reports without making any LLM call.

---

## 6. The Five Proposed Modules

```
┌────────────────────────────────────────────────────────────────────────┐
│                   AI SKILL PROOF BUILDER PIPELINE                      │
└────────────────────────────────────────────────────────────────────────┘
       │
       ▼
 [ MODULE A ] ───► Extract & Normalize Skills from Local/Pasted JD, CV, & Profile
       │
       ▼
 [ MODULE B ] ───► Collect Evidence (Manifests, Configs, READMEs, Source, Tests)
       │
       ▼
 [ MODULE C ] ───► Map Skills to Categorized Artifacts (Many-to-Many Matrix)
       │
       ▼
 [ MODULE D ] ───► Evaluate Evidence via 4 Tiers (Agent / Heuristic JSON Output)
       │
       ▼
 [ MODULE E ] ───► Validate JSON & Generate Skill Proof Report via Shared Reporter
```

- **Module A: Skill Extraction Engine (`lib/skill-proof-extractor.mjs`):** Ingests demand-side (local file or pasted text JD) and supply-side (CV/Profile) skills, normalizes tokens via `skill-extract.mjs`, and assigns taxonomy categories (`languages`, `frameworks`, `databases`, `cloud_devops`, `ai_ml`, `testing_qa`, `methodologies_tools`).
- **Module B: Evidence Collection Engine (`lib/skill-proof-github.mjs` & `lib/skill-proof-manifests.mjs`):** Connects via `gh` CLI (`spawnSync` with argument arrays) or public REST API; retrieves repository metadata, language byte breakdowns, sanitized READMEs (capped at 6,000 chars, matching `MAX_README_LENGTH` from `github-evidence.mjs`), package manifests, configuration files, automated tests, and bounded static source files.
- **Module C: Skill-Evidence Mapping Engine (`lib/skill-proof-mapper.mjs`):** Correlates normalized skills with categorized artifacts into a structured Many-to-Many matrix, maintaining clear separation across:
  1. `dependency_manifests`
  2. `configuration_files`
  3. `source_code`
  4. `tests`
  5. `documentation`
- **Module D: Evidence Evaluation Engine (`modes/skill-proof.md` for AI Agent; `lib/skill-proof-evaluator.mjs` for Heuristic):** Evaluates evidence against the 4 assessment tiers (`STRONG_EVIDENCE`, `PARTIAL_EVIDENCE`, `NO_EVIDENCE_FOUND`, `UNABLE_TO_VERIFY`) with transparent reasoning citing exact files. In AI agent mode, the LLM emits a strictly formatted JSON structure conforming to `skill-proof-report.v1`. In CLI mode, `lib/skill-proof-evaluator.mjs` computes the assessment deterministically. In both modes, `lib/skill-proof-evaluator.mjs` validates the JSON schema integrity before report generation.
- **Module E: AI Recommendation & Skill Proof Report (`lib/skill-proof-reporter.mjs`):** Shared report generator that consumes the validated JSON payload (from either the agent or CLI evaluator), synthesizes actionable upgrade recommendations, and writes Markdown and JSON reports to `data/skill-proof/report-{company-slug}-{date}.{md,json}`.

---

## 7. MVP Scope & Evidence Quality Hierarchy

### Artifact Categories Separation
Evidence artifacts are strictly partitioned into five distinct categories with specific evidentiary limits:
1. `dependency_manifests`: Package declarations (e.g. `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`). Demonstrates dependency presence; capped at `PARTIAL_EVIDENCE`.
2. `configuration_files`: Deployment or build setups (e.g. `Dockerfile`, `docker-compose.yml`, `tsconfig.json`). Demonstrates environment configuration; capped at `PARTIAL_EVIDENCE` when standing alone.
3. `source_code`: Application and domain logic implementation files (e.g. `*.py`, `*.ts`, `*.go`, `*.rs`). Demonstrates direct algorithmic and functional invocation.
4. `tests`: Automated unit, integration, or end-to-end test suites (e.g. `test_*.py`, `*.test.ts`, `*_test.go`). Demonstrates verification and quality assurance.
5. `documentation`: Project narratives and descriptions (e.g. `README.md`, `docs/*.md`). Demonstrates contextual intent; capped at `PARTIAL_EVIDENCE`.

### Evidence Quality Hierarchy & STRONG_EVIDENCE Rigor
We explicitly enforce a 4-level evidence quality hierarchy:
1. **Manifest Declaration:** Package declared in `package.json` or `requirements.txt`. Shows dependency intent. **Maximum grade: `PARTIAL_EVIDENCE`** (never `STRONG_EVIDENCE` alone).
2. **Documentation Mention:** Technology mentioned in `README.md` or docs. Shows narrative intent. **Maximum grade: `PARTIAL_EVIDENCE`** (never `STRONG_EVIDENCE` alone).
3. **Basic Source Code or Config:** Incidental usage, boilerplate setup, or configuration without core logic. **Maximum grade: `PARTIAL_EVIDENCE`**. *(A configuration file alone cannot qualify for `STRONG_EVIDENCE`)*.
4. **Meaningful Implementation & Integration:** Demonstrates substantive business/domain logic, architectural integration, and error handling. **Qualifies for `STRONG_EVIDENCE`**.
   - **Role of Automated Tests:** Automated unit or integration tests directly exercising the technology are **strongly positive and elevate confidence to `HIGH`**, but are **not strictly mandatory** if there is extensive, substantive domain/business logic actively implemented and multi-component architectural integration in source code.

### Deterministic Source-File Selection (5 Files per Repository Limit)
Within the universal limit of inspecting at most 5 source files per repository (max 50 KB per file), files matching candidate skills are selected deterministically using a tiered prioritization rule:
- **Priority 1 (Schemas & Data Models):** Database schemas, ORM models, migration definitions (e.g., `schema.sql`, `models.py`, `models.ts`, `entities/`, `migrations/`).
- **Priority 2 (Core Application Logic & Endpoints):** Service entrypoints, route handlers, controllers (e.g., `main.py`, `app.py`, `server.ts`, `router.ts`, `routes/`, `api/`).
- **Priority 3 (Infrastructure & Containers):** Container and orchestration configs (e.g., `Dockerfile`, `docker-compose.yml`).
- **Priority 4 (Automated Test Suites):** Test files matching the technology (e.g., `*.test.js`, `*.test.ts`, `test_*.py`, `*_test.go`).

Within each priority tier, matching files are sorted strictly in ascending lexicographical order by relative repository path. If matching files exceed 5, the top 5 by priority tier and lexicographical path are selected deterministically.

### MVP Inclusions vs. Deferred Features
- **Included in MVP:**
  - Skill extraction via `skill-extract.mjs` (`extractSkills`, `canonicalize`) and `jd-skill-gap.mjs` (`extractJdSkills`).
  - **Job Description Input:** Strictly local text/markdown files (e.g. `jds/acme.md`, `data/pipeline.md`) or verbatim pasted text via chat/`--stdin`. (Remote URL fetching is deferred to V2 to avoid SSRF, anti-bot, and authentication complexities).
  - Public GitHub repository metadata discovery and language byte breakdown via `gh` CLI and public REST API.
  - Static dependency manifest parsing for Node.js (`package.json`), Python (`requirements.txt`, `pyproject.toml`), Go (`go.mod`), Rust (`Cargo.toml`), and Docker (`Dockerfile`).
  - Bounded README inspection (max 6,000 characters per repository, matching `MAX_README_LENGTH` from `github-evidence.mjs`).
  - **Bounded static source-file inspection:** Inspecting up to 5 deterministically selected files per repository, max 50 KB per file, across at most 15 repositories, with zero code execution.
  - 4-tier qualitative evaluation rubric (`STRONG_EVIDENCE`, `PARTIAL_EVIDENCE`, `NO_EVIDENCE_FOUND`, `UNABLE_TO_VERIFY`) with mandatory file citations.
  - Deterministic heuristic evaluation engine in `lib/skill-proof-evaluator.mjs` for zero-token CLI and CI testing.
  - AI Agent mode producing validated structured JSON consumed by the shared `lib/skill-proof-reporter.mjs`.
  - Actionable recommendations for `PARTIAL_EVIDENCE` and `NO_EVIDENCE_FOUND` skills.
  - Structured Markdown and JSON reporting to `data/skill-proof/`.
- **Deferred to V2 & V3:**
  - Automated remote JD URL fetching and live web crawling (requires SSRF security proxies and headless browser integration).
  - Full Abstract Syntax Tree (AST) parsing and multi-file call-graph tracing.
  - Multi-platform forge support (GitLab, Bitbucket).
  - Continuous background evidence watchers.

---

## 8. Proposed Architecture & System Boundary

The design conforms strictly to Career-Ops principles:
- **Local-First & Flat-Root:** Executable script at root (`skill-proof.mjs`), reusable ES modules in `lib/`, prompt mode in `modes/`. No background web servers, daemons, or microservices.
- **Data Contract Separation:** System files are registered in `SYSTEM_PATHS` in `lib/update-manifest.mjs`. All user outputs are written strictly to `data/skill-proof/` (User Layer, protected by `update-system.mjs`).
- **Non-Destructive:** Strictly adheres to the **Confirm-Before-Write** doctrine. It never automatically modifies `cv.md` or candidate files.

---

## 9. Reusable Existing Components

We explicitly avoid reinventing existing wheels by importing:
- `skill-extract.mjs` → `extractSkills()`, `canonicalize()`, `CANONICAL` (single source of truth for hard skills; prevents tokenizer drift #1896).
- `jd-skill-gap.mjs` → `extractJdSkills()` (JD requirement section parsing).
- `github-evidence.mjs` → `normalizeGithubUser()`, `readPrivateAllowlist()`, `defaultGhRunner()` (safe `spawnSync` invocation, username normalization, and private repo allowlisting #5295).
- `path-resolver.mjs` → `getCareerOpsRoot()`, `getProfilePath()` (dynamic User Layer data root resolution).
- `utils/privacy-filter.mjs` → `redactIfEnabled()` (PII scrubbing before LLM evaluation).
- `tests/helpers.mjs` → `pass()`, `fail()`, `ROOT`, `NODE` (testing harness).

---

## 10. Proposed New Files

| File Path | Layer | Responsibility |
| :--- | :--- | :--- |
| `skill-proof.mjs` | System | Root CLI executable and argument parser (`--jd`, `--github`, `--json`, `--summary`, `--self-test`). Deterministic execution without LLM. |
| `modes/skill-proof.md` | System | Agent prompt mode defining AI evaluation rubric and XML injection containment. |
| `lib/skill-proof-extractor.mjs` | System | Skill extraction wrapper, normalization, and categorization taxonomy. |
| `lib/skill-proof-github.mjs` | System | Safe GitHub discovery via `gh` CLI / public REST API with rate limit guards. |
| `lib/skill-proof-manifests.mjs` | System | Multi-language static package manifest parsers. |
| `lib/skill-proof-mapper.mjs` | System | Many-to-Many correlation engine connecting skills to evidence artifacts. |
| `lib/skill-proof-evaluator.mjs` | System | JSON schema validator for AI agent output (`skill-proof-report.v1`) and zero-LLM deterministic heuristic fallback evaluator. |
| `lib/skill-proof-reporter.mjs` | System | Shared Markdown and JSON report generator and recommendation synthesizer consuming validated evaluation JSON. |
| `tests/skill-proof-*.test.mjs` | System | Unit, integration, schema, mock, and security test suites. |
| `docs/SKILL_PROOF.md` | System | Feature documentation and usage guide. |
| `data/skill-proof/` | User | Target directory for generated reports (never touched by updater). |

---

## 11. GitHub Integration & Security Approach
- **Safe Process Invocation:** Uses `spawnSync('gh', args, { shell: false })` via `defaultGhRunner()`. Arguments are passed strictly as array elements with zero shell string interpolation.
- **Dual Mode:** Uses authenticated `gh api` if available (5,000 req/hr); falls back gracefully to zero-key public REST API (60 req/hr).
- **Private Repositories:** Never touched unless explicitly allowlisted by the user in `config/profile.yml` (`github_evidence.private_allowlist`).
- **Rate Limit Protection:** Inspects `x-ratelimit-remaining`; halts network calls when fewer than 5 requests remain; marks unverified repos as `UNABLE_TO_VERIFY (rate_limited)`.
- **Bounded Inspection:** Max 15 repositories, max 6,000 chars per README (matching `MAX_README_LENGTH` from `github-evidence.mjs`), max 5 deterministically prioritized source files per repo, max 50 KB per file.
- **Zero Code Execution:** The system **never** runs `npm install`, `python`, `eval()`, or `child_process.exec()` on repository code. All analysis is purely static.
- **Untrusted Content Protocol & Prompt Injection Defense:** All external repository text is treated strictly as untrusted data (`AGENTS.md`). While XML tags (`<untrusted_evidence_content>`) are used to structurally delineate external content, **XML delimiters are organizational boundary markers, not a standalone security guarantee**. The system enforces defense-in-depth: zero code execution, explicit instructions commanding the model to ignore embedded directives/overrides, rigid output schema validation, and human review. Repository content is never permitted to override system prompts, user instructions, or evaluation scoring rules.

---

## 12. Assessment Rubric & Confidence Calibration
1. `STRONG_EVIDENCE`: Direct, substantive implementation demonstrating core domain/business logic, multi-component architectural integration, and implementation context. Automated tests directly exercising the technology strongly elevate confidence to `HIGH`, but are not strictly mandatory if substantive implementation logic and integration exist. **A configuration file alone (e.g. basic Dockerfile or config.yaml), a manifest declaration alone, or a README mention alone CANNOT qualify.**
2. `PARTIAL_EVIDENCE`: Declarative only (manifest only), shallow tutorial code, configuration without application code, or README-only mentions.
3. `NO_EVIDENCE_FOUND`: Claimed or required, but zero traces found in accessible evidence. *(Mandatory rule: absence of public proof does NOT indicate lack of ability).*
4. `UNABLE_TO_VERIFY`: Inaccessible source (private unauthorized, rate-limited, deleted).

**Confidence:** Discrete qualitative tiers (`HIGH`, `MEDIUM`, `LOW`) rather than uncalibrated pseudo-probabilities.

---

## 13. Testing Strategy
- **Zero Frameworks:** Integrated with `node test-all.mjs` auto-discovery via `tests/**/*.test.mjs`. Uses `pass()` / `fail()` from `tests/helpers.mjs`.
- **In-Process Safety:** Never calls `process.exit()` or `finish()`.
- **Hermetic Execution:** Mock fixtures for GitHub API responses. Tests run 100% offline without network access or credentials.
- **Security Tests:** Validating prompt injection containment, rate-limit handling, and path traversal guards.

---

## 14. Backward Compatibility & Data Contract Safety
- **Zero Breaking Changes:** Does not modify existing evaluation modes (`oferta.md`), scoring logic, or tracking schemas.
- **Data Contract:** All outputs land in `data/skill-proof/` (User Layer). System files are cleanly registered in `SYSTEM_PATHS` in `lib/update-manifest.mjs`.
- **Zero New Dependencies:** Pure ESM JavaScript relying solely on Node.js built-ins (`fs`, `path`, `crypto`, `child_process`).

---

## 15. Technical Justification: Why This Fits Career-Ops
1. **Preserves the Flat Root & Conventions:** Follows the exact script and mode patterns of `upskill.mjs`, `jd-skill-gap.mjs`, and `github-evidence.mjs`.
2. **Eliminates Tokenizer Drift:** Imports `skill-extract.mjs` directly, respecting the architectural work done in #1896.
3. **Respects User Sovereignty:** Generates advisory audit reports without modifying `cv.md` without permission.
4. **Zero Dependency Overhead:** Adds zero weight to `package.json`, keeping fresh clone installation fast and reliable.

---

## 16. Expected Benefits to Career-Ops Users
- **Pre-Application Confidence:** Candidates can audit their technical evidence against target JDs before applying, catching weak proof points before recruiters do.
- **Actionable Upgrade Guidance:** Instead of generic advice, candidates receive specific repository enhancement steps (e.g., adding database migrations or Docker healthchecks).
- **High-Signal Interview Preparation:** Verified evidence directly feeds into technical interview talking points and STAR story preparation.

---

## 17. Open Questions for Maintainers
1. **Output Directory Placement:** Do maintainers prefer `data/skill-proof/report-*.md` (isolated user-layer folder), or should reports be colocated under `reports/` (e.g. `reports/proof-{company}-{date}.md`)? *(Our recommendation: `data/skill-proof/` to avoid colliding with `reserve-report-num.mjs` atomic numbering).*
2. **Root CLI Naming:** Should the root executable be `skill-proof.mjs` or the shorter `proof.mjs`? *(Our recommendation: `skill-proof.mjs` for clarity).*
3. **`package.json` Scripts:** Is registering `"skill:proof": "node skill-proof.mjs"` and `"proof": "node skill-proof.mjs"` approved?
4. **Update Manifest Registration:** Should `lib/update-manifest.mjs` registration be included in the primary PR? *(Our recommendation: Yes, to ensure CI coverage passes).*
