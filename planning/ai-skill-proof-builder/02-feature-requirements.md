# 02 — Feature Requirements & Problem Definition

## 1. Problem Definition

### 1.1 The Core Problem
In the modern technical job market, resumes and portfolios suffer from a profound **evidence deficit**:
1. **Keyword Stuffing vs. Verified Capability:** Candidates routinely list dozens of technical skills, frameworks, and tools in their CVs ("Python, Kubernetes, Kafka, PyTorch, React, AWS"). Standard Applicant Tracking Systems (ATS) and keyword-matching tools check only whether a token exists. However, hiring managers and technical interviewers screen for *practical evidence* of working competence.
2. **The "Hello World" Dilemma:** Having a repository named `kafka-demo` or having `import torch` in a 10-line script does not demonstrate production-grade proficiency. Conversely, candidates frequently fail to showcase existing deep architectural work buried in their public repositories.
3. **Lack of Actionable Feedback:** When rejected or screened out, candidates rarely know whether the issue was a lack of skills or simply an absence of verifiable proof in their public artifacts.

### 1.2 The Skill-Proof Value Chain
The AI Skill Proof Builder establishes an end-to-end verifiable relationship:
```
Job Requirement (JD) 
      ↓
Candidate-Claimed Skill (CV / Profile) 
      ↓
Supporting Evidence (GitHub Repos, Manifests, Source Code, Documentation) 
      ↓
Evidence Assessment (Strong, Partial, No Evidence Found, Unable to Verify) 
      ↓
Actionable Recommendations (Code Examples, Architecture Proof Points, Schema Demos)
```

### 1.3 Who Benefits
- **Technical Candidates & Job Seekers:** Gain an objective, audit-grade evaluation of their own public proof points before applying, along with concrete instructions on how to upgrade weak repositories into compelling evidence.
- **Hiring Managers & Reviewers:** Receive candidate applications where claims are tied directly to verified public implementations, eliminating resume exaggeration.
- **Open-Source Maintainers & Career-Ops Users:** Enhances the Career-Ops ecosystem by adding high-signal verification without compromising privacy or local execution.

### 1.4 How It Differs from Ordinary Resume Analysis
| Feature | Ordinary Resume Analysis (e.g. ATS Scan) | AI Skill Proof Builder |
| :--- | :--- | :--- |
| **Primary Input** | Resume text only. | Resume + Job Description + Public Repositories + Code Manifests. |
| **Verification Depth** | Token matching (Does "Docker" appear in the text?). | Implementation audit (Does the repo contain multi-stage Dockerfiles, compose setups, or CI pipelines?). |
| **Evidence Linkage** | None. Assumes text claims are true. | Deterministic and qualitative mapping between skill claims and verifiable code artifacts. |
| **Outcome** | Keyword density / ATS score. | Skill Proof Report with assessment levels, evidence citations, and technical upgrade recommendations. |

### 1.5 Functionality That Must NOT Be Duplicated
- **Do not rewrite `skill-extract.mjs`:** Must import and reuse the canonical skill tokenizer and alias dictionary.
- **Do not rewrite `jd-skill-gap.mjs`:** Must reuse JD requirement section parsing and heading classification.
- **Do not duplicate `add-entry.mjs`:** Must not attempt to directly write skills or projects to `cv.md` without going through established user-gated tools.
- **Do not replace `modes/oferta.md`:** Skill Proof Builder evaluates evidence depth for skills; it does not replace the comprehensive 7-block offer scoring in `oferta`.

---

## 2. Functional Requirements (FR)

### Module A: Skill Extraction
- **FR-01 (Job Requirement Extraction):** The system shall extract required technical skills, languages, tools, frameworks, and methodologies from a user-supplied Job Description or URL, leveraging `jd-skill-gap.mjs`.
- **FR-02 (Candidate Skill Extraction):** The system shall extract claimed skills from candidate documents (`cv.md`, `config/profile.yml`, `data/career-profile.yml`, and `article-digest.md`).
- **FR-03 (Skill Normalization):** The system shall normalize all extracted skills using the canonical mappings in `skill-extract.mjs` (e.g., `k8s` → `Kubernetes`, `postgres` → `PostgreSQL`).
- **FR-04 (Skill Categorization):** The system shall classify extracted skills into standardized categories: Languages, Frameworks/Libraries, Databases/Storage, Cloud/DevOps, AI/ML/Data, Testing/QA, and Methodologies/Tools.
- **FR-05 (Provenance Tracking):** The system shall record the exact source location (file name, section, line number, or JD excerpt) for every extracted skill.

### Module B: Evidence Collection
- **FR-06 (GitHub Discovery via `gh` or Public REST API):** The system shall discover accessible repositories for the candidate using their normalized GitHub username from `config/profile.yml` or CLI flags, supporting both authenticated `gh` CLI and zero-token public API fallback.
- **FR-07 (Repo Metadata & Language Breakdown):** The system shall retrieve repository metadata (stars, fork status, visibility, primary language, GitHub language byte breakdown, and description).
- **FR-08 (Fork & Non-Author Filtering):** The system shall filter out forked repositories unless explicit authored commits or PRs by the user are confirmed, adhering to the principle that owning a fork does not prove authorship.
- **FR-09 (Dependency Manifest Inspection):** The system shall inspect standard project dependency manifests (e.g., `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `Gemfile`, `Dockerfile`) to verify declared technical dependencies.
- **FR-10 (Safe README & Documentation Retrieval):** The system shall retrieve repository README files and documentation under strict byte and line caps (max 6,000 characters per file, matching `MAX_README_LENGTH` from `github-evidence.mjs`) without executing any code.
- **FR-11 (Bounded Source File Sampling):** The system shall support inspecting targeted source files directly relevant to candidate claims (e.g., locating SQL schemas, API route handlers, model definitions) up to a bounded maximum file size (50 KB per file; max 5 files per repository; max 15 repositories total).
- **FR-12 (Private Repository Guard):** The system shall strictly refuse to access private repositories unless explicitly allowlisted by the user in `config/profile.yml` under `github_evidence.private_allowlist`.

### Module C: Skill-Evidence Mapping
- **FR-13 (Many-to-Many Mapping):** The system shall establish many-to-many relationships between candidate skills and collected evidence items (one skill can be proven by multiple projects; one project can provide evidence for multiple skills).
- **FR-14 (Mapping Record Schema):** The system shall generate a structured mapping record containing: `skill_id`, `canonical_name`, `evidence_id`, `evidence_type` (e.g., `dependency_manifest`, `source_code`, `readme`, `architecture_doc`), `file_path`, `code_excerpt_or_summary`, and `heuristic_weight`.

### Module D: Evidence Evaluation
- **FR-15 (Standardized Assessment Tiers):** The system shall classify evidence for each skill into one of four mutually exclusive assessment tiers:
  1. `STRONG_EVIDENCE`: Direct, substantive implementation demonstrating core domain/business logic, multi-component architectural integration, or automated tests. **A configuration file alone (e.g., a basic Dockerfile or config.yaml) or a manifest/README mention alone cannot qualify as STRONG_EVIDENCE.**
  2. `PARTIAL_EVIDENCE`: Incidental, shallow, or purely declarative usage (e.g., dependency declared in `package.json`, isolated tutorial snippet, or README mention without implementation).
  3. `NO_EVIDENCE_FOUND`: Skill is claimed by candidate or required by JD, but no verifiable evidence exists in accessible repositories or project files. *(Mandatory rule: absence of public proof does not imply lack of skill).*
  4. `UNABLE_TO_VERIFY`: Referenced source is inaccessible (private repo without authorization, deleted repo, network rate limit, binary/unsupported file type).
- **FR-16 (Anti-Hallucination & Reasoning Guard):** The evaluator shall provide transparent, verifiable reasoning for every tier assignment, citing exact repository file paths and line excerpts. The evaluator must never invent repository contents or assume unobserved code exists.
- **FR-17 (Distinction of Facts vs Inferences):** The system shall explicitly differentiate between verified deterministic facts (e.g. "package `pg` v8.11 declared in package.json") and qualitative interpretations (e.g. "complex connection pooling implemented").

### Module E: Recommendations & Reporting
- **FR-18 (Actionable Upgrade Recommendations):** For any skill evaluated as `PARTIAL_EVIDENCE` or `NO_EVIDENCE_FOUND`, the system shall generate concrete, practical technical steps the candidate can take in their repository to elevate the proof to `STRONG_EVIDENCE` (e.g. adding database migrations, integration tests, or architectural documentation).
- **FR-19 (Skill Proof Report Generation):** The system shall generate a structured Markdown and JSON report (`data/skill-proof/report-{company-slug}-{date}.md` and `.json`), summarizing: Target Role, Required vs Claimed Skills, Evidence Mapping Matrix, Evidence Assessment Tiers, Actionable Recommendations, and Assessment Limitations.
- **FR-20 (Non-Destructive User-Layer Preservation):** The system shall never overwrite or silently edit `cv.md` or candidate profile files. All outputs must be saved to user-layer data directories (`data/skill-proof/`).

---

## 3. Non-Functional Requirements (NFR)

### 3.1 Performance
- **NFR-01 (Execution Speed):** Deterministic extraction and metadata gathering (Modules A, B, C) for up to 10 repositories must complete within 15 seconds under normal network conditions.
- **NFR-02 (Token Efficiency):** The AI evaluation payload must be strictly distilled, sending AST/manifest summaries and targeted code excerpts rather than entire repositories. Single-skill evaluation prompt payload must remain under 3,000 tokens.

### 3.2 Security & Threat Mitigation
- **NFR-03 (Untrusted External Content Rule & Prompt Injection Defense):** All external repository files (READMEs, code comments, issue titles, source code) must be treated as untrusted data, never as executable instructions (`AGENTS.md` protocol). While XML tags (`<untrusted_evidence_content>`) are used to structurally delineate external content, they serve as organizational boundaries, not a standalone security guarantee. Full defense-in-depth requires: 1) static zero code execution, 2) explicit system prompt directives commanding the model to ignore instructions/overrides embedded in repository files, 3) strict schema validation of outputs, and 4) human review before any downstream action. Repository content must never be permitted to override system prompts, user instructions, or evaluation scoring rules.
- **NFR-04 (Zero Code Execution):** The system shall never compile, run, install (`npm install`, `pip install`), or execute code from inspected repositories. All analysis must be strictly static and textual.
- **NFR-05 (Credential Protection):** The system must never store, log, or prompt for GitHub credentials or API tokens in plain text. Tokens must only be loaded from environment variables (`GITHUB_TOKEN`, `GH_TOKEN`) or inherited from the local authenticated `gh` CLI session.

### 3.3 Privacy
- **NFR-06 (Local-First Confinement):** Candidate evidence and generated reports must reside exclusively on the user's local disk. No telemetry, candidate metrics, or code excerpts shall be sent to any third-party server other than the user's explicitly configured LLM provider.
- **NFR-07 (PII Redaction):** The system must integrate with Career-Ops' existing `utils/privacy-filter.mjs` to redact emails, phone numbers, and home addresses before sending excerpts to external AI providers.

### 3.4 Maintainability & Extensibility
- **NFR-08 (Modularity):** Modules must follow the flat-root ESM convention of Career-Ops (`skill-proof.mjs`, `lib/skill-proof-*.mjs`) with clean single-responsibility interfaces.
- **NFR-09 (Zero Native Dependencies):** The core engine must run on standard Node.js (>=22.13.0) without requiring native C++ build tools or external compiled binaries.

### 3.5 Reliability & Error Handling
- **NFR-10 (Graceful Degradation):** In the event of GitHub API rate limiting (HTTP 403/429) or missing network access, the system must degrade gracefully, classifying inaccessible sources as `UNABLE_TO_VERIFY` with clear status messaging rather than crashing.
- **NFR-11 (AI Fallback):** When external LLM APIs are unavailable or fail validation, the system must fall back to a deterministic heuristic evaluation mode that scores evidence based on manifest dependencies and README verification.

---

## 4. Release Phasing: MVP, V2, and V3

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           RELEASE ROADMAP                               │
├───────────────────────────┬───────────────────────────┬─────────────────┤
│           MVP             │            V2             │       V3        │
│   (Core High-Signal)      │   (Deep Source & AST)     │ (Multi-Platform)│
├───────────────────────────┼───────────────────────────┼─────────────────┤
│ • Canonical Skill Extr.   │ • Targeted Source Files   │ • GitLab /      │
│ • Public GitHub Metadata  │ • AST Manifest Parsing    │   Bitbucket     │
│ • Manifest Inspection     │ • Multi-model LLM Eval    │ • Continuous    │
│ • 4-Tier Evaluation       │ • Interactive CLI Review  │   Proof Watcher │
│ • Markdown/JSON Report    │ • Automated Code Snippets │ • PR Diff Proof │
│ • Actionable Recs         │ • Star/PR Proof Signals   │ • Direct Plugin │
└───────────────────────────┴───────────────────────────┴─────────────────┘
```

### 4.1 Phase 1: MVP (Minimum Viable Product)
**Objective:** Deliver an immediate, production-grade, high-value evidence evaluation tool that integrates cleanly into Career-Ops with zero new dependencies.

**In-Scope:**
1. Integration with `skill-extract.mjs` for candidate and JD skill extraction.
2. Discovery of candidate public GitHub repositories via `gh` CLI or public GitHub REST API.
3. Static inspection of project dependency manifests (`package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Dockerfile`).
4. Bounded README inspection (up to 8 KB per repo) for architecture, usage, and schema mentions.
5. Deterministic Skill-Evidence Mapping matrix.
6. AI Evidence Evaluation Engine delivering the 4 tiers (`STRONG_EVIDENCE`, `PARTIAL_EVIDENCE`, `NO_EVIDENCE_FOUND`, `UNABLE_TO_VERIFY`) with concise reasoning.
7. Structured Skill Proof Report generated to `data/skill-proof/report-{company-slug}-{date}.md` and `.json`.
8. Tactical recommendations for upgrading `PARTIAL_EVIDENCE` skills.
9. Full integration with a new interactive prompt mode: `modes/skill-proof.md`.

**Why MVP Scope is Scoped Here:**
Manifests + READMEs + repository metadata cover >80% of false claims (e.g. claims of "React" when the repo is pure HTML, or claims of "Kafka" with no dependency declared). It eliminates risk by avoiding complex arbitrary code parsing while delivering immediate clarity to the user.

### 4.2 Phase 2: V2 (Deep Code Inspection & Enhanced Intelligence)
**Objective:** Deeper code inspection, multi-file verification, and tight integration with interview preparation.

**In-Scope:**
1. Targeted source file inspection: Locating and reading specific business logic files (e.g., ORM models, API routes, pipeline stages) up to 50 KB.
2. Lightweight regex/AST-based feature detectors (e.g. verifying database transactions, concurrency primitives, or model training loops).
3. Authored commit and PR cross-referencing (verifying that the user authored the specific files rather than just committing a package bump).
4. Direct linkage with `interview-prep/story-bank.md`: auto-generating STAR stories grounded in verified technical evidence.
5. Interactive refinement gate allowing the user to provide manual file hints for ambiguous skills.

### 4.3 Phase 3: V3 (Ecosystem & Multi-Platform Integration)
**Objective:** Enterprise and multi-platform expansion.

**In-Scope:**
1. Additional forge integrations (GitLab, Bitbucket, self-hosted Gitea).
2. Live portfolio & API endpoint probing (verifying that a deployed web app or microservice is live and responsive).
3. Continuous Evidence Watcher: background monitoring of new commits to update skill proof scores dynamically.
4. Exportable "Technical Proof Verification" artifact designed for hiring managers.

---

## 5. Risks and Mitigations

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **AI Hallucination of Code** | High (false confidence, invalid claims) | Enforce deterministic evidence capture before calling LLM. The prompt only receives raw, verbatim code/manifest extracts. Output parser enforces that every claim must cite an exact file path and line number present in the prompt. |
| **Prompt Injection via README/Code** | High (jailbreak, altered assessment) | Treat all fetched content as untrusted data (`AGENTS.md` protocol). Wrap external excerpts in rigid XML/Markdown containment tags (`<untrusted_evidence_content>`). System instructions explicitly instruct the model to ignore imperative commands inside evidence blocks. |
| **GitHub API Rate Limits** | Medium (process termination) | 1) Prefer local `gh` CLI which uses user's authenticated pool (5,000 req/hr).<br>2) Implement exponential backoff and conditional `ETag` caching in `data/cache/github/`.<br>3) Gracefully mark unqueried repos as `UNABLE_TO_VERIFY (rate_limited)`. |
| **Repository Size & Token Bloat** | Medium (high cost, slow execution) | Never fetch entire repositories. Only fetch manifests, READMEs, and targeted file snippets. Hard ceiling: 6,000 chars per README, 50 KB max per source file, max 5 source files per repository. |
| **Misleading Repo Presence (Forks/Clones)** | High (false positive skills) | Exclude forked repositories by default (`"fork": true`). For unforked repos, verify author commits on the default branch using `git log` or GitHub commit author search. |
| **Candidate Lacks Public Repositories** | Medium (inability to verify) | Explicitly document that `NO_EVIDENCE_FOUND` does **not** mean the candidate lacks the skill—it only means public verification is absent. Provide recommendations on how to publish an open-source proof-of-work project. |
