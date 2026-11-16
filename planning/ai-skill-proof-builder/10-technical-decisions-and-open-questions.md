# 10 — Technical Decisions & Open Questions

## 1. Architectural Decision Records (ADRs)

### ADR-01: Modular Flat-Root CLI Script vs. Standalone Microservice / Server
- **Status:** Accepted.
- **Context:** Modern web applications frequently implement AI evaluation features as background REST/GraphQL microservices (e.g. Express, NestJS, FastAPI).
- **Decision:** Reject any background web server or daemon. Implement the feature as a flat-root executable script (`skill-proof.mjs`) supported by ES modules in `lib/` (`lib/skill-proof-*.mjs`) and an agent mode in `modes/skill-proof.md`.
- **Rationale:** Career-Ops is fundamentally an agentic, local-first CLI tool (`ARCHITECTURE.md`). Users run the tool directly from their terminal or AI coding CLI without requiring background servers, Docker containers, or open ports.

---

### ADR-02: Reusing Canonical `skill-extract.mjs` vs. Introducing a New Skill Taxonomizer
- **Status:** Accepted.
- **Context:** We considered using external ontology libraries or creating a comprehensive new taxonomy engine.
- **Decision:** Directly import and reuse `skill-extract.mjs` and `jd-skill-gap.mjs` as the single source of truth for skill recognition and alias canonicalization.
- **Rationale:** The repository maintainers previously consolidated drifting skill tokenizers into `skill-extract.mjs` (#1896). Introducing another tokenizer would re-introduce the exact "tokenizer drift" bug class the maintainers worked hard to eliminate (e.g., CV "k8s" failing to match JD "Kubernetes").

---

### ADR-03: Dual-Mode GitHub Access (`gh` CLI First, Zero-Key Public REST Fallback)
- **Status:** Accepted.
- **Context:** Querying GitHub requires handling authentication and rate limits. Options included requiring a `GITHUB_TOKEN` in `.env`, using the `gh` CLI exclusively, or relying solely on unauthenticated API calls.
- **Decision:** Implement a dual-mode hierarchy:
  1. Primary: Use the local authenticated `gh` CLI (`gh api`) if installed and logged in.
  2. Fallback: Use Node.js native `fetch` against the unauthenticated public REST API (`api.github.com`).
- **Rationale:** Requiring tokens in `.env` introduces credential exposure risks. The `gh` CLI provides 5,000 req/hr and inherits user authentication seamlessly. The unauthenticated REST fallback ensures that users without `gh` can still run the tool on public repositories out of the box.

---

### ADR-04: Static Artifact Inspection & Deterministic Selection vs. Full AST & Dynamic Execution
- **Status:** Accepted.
- **Context:** To prove a skill, one could theoretically clone the entire repository, install dependencies, run tests, or execute an Abstract Syntax Tree (AST) parser on all files.
- **Decision:** For the MVP, strictly limit code inspection to static package manifests (`package.json`, `requirements.txt`, `go.mod`, etc.), README files (max 6,000 characters), and bounded key source files (max 5 files per repository, max 50 KB per file, across at most 15 repositories). Partition artifacts into 5 distinct categories:
  1. `dependency_manifests`
  2. `configuration_files`
  3. `source_code`
  4. `tests`
  5. `documentation`
  Within each repository, prioritize files deterministically: Priority 1 (Schemas/Models), Priority 2 (Routes/Entrypoints), Priority 3 (Containers/Configs), Priority 4 (Tests), sorted lexicographically. Strictly forbid downloading entire codebases or executing code.
- **Rationale:**
  1. **Security:** Running `npm install` or executing code from arbitrary repositories violates Career-Ops security rules and invites remote code execution.
  2. **Performance:** Downloading full repositories introduces massive latency and bandwidth consumption.
  3. **High Signal Ratio:** Categorized manifests, configs, and bounded key source files provide sufficient signal to verify whether a technology was actively used or merely declared.

---

### ADR-05: Discrete Qualitative 4-Tier Assessment vs. Continuous Percentage Scores
- **Status:** Accepted.
- **Context:** Many AI tools output continuous scores like "Skill Match: 84.6%".
- **Decision:** Classify evidence into four discrete, explainable tiers: `STRONG_EVIDENCE`, `PARTIAL_EVIDENCE`, `NO_EVIDENCE_FOUND`, and `UNABLE_TO_VERIFY`, accompanied by qualitative confidence (`HIGH`, `MEDIUM`, `LOW`).
  - Automated tests directly exercising the technology are strongly positive and elevate confidence to `HIGH`, but are not strictly mandatory for `STRONG_EVIDENCE` if substantive domain/business logic and multi-component architectural integration exist in source code.
  - Manifest declarations alone, documentation mentions alone, or basic configuration files alone can never qualify as `STRONG_EVIDENCE` (strictly capped at `PARTIAL_EVIDENCE`).
- **Rationale:** Pseudo-numeric percentages manufactured by an LLM convey false mathematical precision without statistical calibration. Discrete tiers provide candidates with clear, unambiguous status and actionable upgrade paths.

---

### ADR-06: Independent Audit Reporting vs. Automated Resume Rewriting
- **Status:** Accepted.
- **Context:** When skill evidence is verified, the system could automatically inject bullets into `cv.md`.
- **Decision:** Strictly prohibit automatic modification of `cv.md`. Generate an independent report in `data/skill-proof/report-*.md` and provide candidate-approved recommendations.
- **Rationale:** Violating the **Confirm-Before-Write** doctrine is an immediate disqualifier for Career-Ops contributions (`AGENTS.md` and `modes/expand.md`). The candidate must always retain sovereign control over their resume.

---

### ADR-07: Local File & Pasted JD Input Boundary vs. Direct URL Fetching
- **Status:** Accepted.
- **Context:** In interactive and automated workflows, users may provide a target job posting as a live URL, local file, or pasted text.
- **Decision:** For the MVP, restrict job description inputs strictly to local text/markdown files (e.g. `jds/acme.md`) or verbatim pasted text via agent chat or CLI `--stdin`. Defer live URL fetching to future phases.
- **Rationale:** Direct URL fetching introduces severe operational and security surface areas, including Server-Side Request Forgery (SSRF), Cloudflare anti-bot challenges, cookie consent barriers, and authentication requirements. By operating strictly on local files and pasted text, the MVP maintains an airtight local-first security posture.

---

### ADR-08: AI Agent Validated JSON Mode & Shared Report Generator
- **Status:** Accepted.
- **Context:** The system offers both an interactive AI agent mode (`modes/skill-proof.md`) and a standalone zero-LLM CLI (`skill-proof.mjs`). They could maintain separate reporting logic.
- **Decision:** Unify the reporting pipeline around a single shared reporter (`lib/skill-proof-reporter.mjs`). In AI agent mode, the LLM emits structured JSON adhering to the `skill-proof-report.v1` schema, which is validated by `lib/skill-proof-evaluator.mjs`. In CLI mode, the deterministic heuristic evaluator generates the same JSON schema. Both feed directly into the shared reporter.
- **Rationale:** Prevents divergence in reporting formats, ensures consistent machine-readable outputs in `data/skill-proof/`, and provides automated validation of LLM outputs.

---

---

## 2. Open Questions Requiring Maintainer Clarification

Before opening the Pull Request, we will present the following focused questions to the repository maintainers:

1. **Target Report Directory Convention:**
   - *Question:* We have proposed storing reports under `data/skill-proof/report-{company-slug}-{date}.md`. Alternatively, Career-Ops stores job evaluations under `reports/{NNN}-{company}-{date}.md` and PDF outputs under `output/`. Does the maintainer team prefer `data/skill-proof/` as a dedicated user-layer directory, or should skill proof reports be colocated inside `reports/` with a specific suffix (e.g. `reports/proof-{company}-{date}.md`)?
   - *Architecture Recommendation:* Keep in `data/skill-proof/` to avoid colliding with `reserve-report-num.mjs` atomic numbering conventions used for primary job offers.

2. **CLI Entrypoint Naming:**
   - *Question:* Should the root script be named `skill-proof.mjs` or `proof.mjs`?
   - *Architecture Recommendation:* Use `skill-proof.mjs` to maintain descriptive, non-ambiguous naming alongside `skill-extract.mjs`.

3. **`package.json` Scripts Integration:**
   - *Question:* Should we register `"skill:proof": "node skill-proof.mjs"` and `"proof": "node skill-proof.mjs"` in `package.json` scripts?
   - *Architecture Recommendation:* Yes, this aligns with existing script aliases (`"keyword-match": "node keyword-match.mjs"`, `"upskill": "node upskill.mjs"`).

4. **Inclusion in `update-manifest.mjs`:**
   - *Question:* When submitting the PR, should the new `lib/skill-proof-*.mjs` files and `modes/skill-proof.md` be bundled into a single PR with the `lib/update-manifest.mjs` registration, or does the maintainer team prefer that `SYSTEM_PATHS` updates land in a separate release PR?
   - *Architecture Recommendation:* Bundle together in the same PR, as required by `tests/update-manifest.test.mjs` and `validate-system-paths-coverage.mjs`.

---

## 3. Summary of Technical Risks & Mitigations

| Technical Risk | Likelihood | Impact | Built-in Mitigation |
| :--- | :--- | :--- | :--- |
| **GitHub Secondary Rate Limits** | Medium | Medium | In-memory and disk caching (`data/cache/github/`), 15 repo ceiling, graceful degradation to `UNABLE_TO_VERIFY`. |
| **Prompt Injection via READMEs** | High | Critical | XML tag containment (`<untrusted_evidence_content>`), explicit system directives, zero-execution rule. |
| **Tokenizer False Gaps** | Low | Medium | Direct reuse of canonical `skill-extract.mjs` and `CANONICAL` alias map. |
| **Candidate Privacy Leakage** | Low | High | Private repo allowlist strictly enforced; PII redacted via `utils/privacy-filter.mjs`. |
| **Test Suite Pollution** | Low | High | Hermetic tests; mock fixtures; isolated test data root via `tests/helpers.mjs`. |
