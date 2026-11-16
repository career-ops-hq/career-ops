# 13 — Existing Feature Overlap & Non-Duplication Analysis

## 1. Executive Summary

A critical requirement for contributing to **Career-Ops** is avoiding functional duplication. Maintainers reject contributions that recreate existing capabilities or introduce parallel, drifting implementations of solved problems (such as when three separate skill tokenizers had to be consolidated into `skill-extract.mjs` under #1896).

This document performs an exhaustive audit of all existing features in Career-Ops related to skills, GitHub data, portfolio projects, and evidence verification. It defines the exact boundaries between existing tools and the proposed **AI Skill Proof Builder**, demonstrating that the proposed feature is non-duplicative, strictly complementary, and deeply integrated with existing primitives.

---

## 2. Comparative Analysis Matrix

| Component | Primary Purpose | Input Sources | Output / Artifact | Overlap with AI Skill Proof Builder | Boundary & Resolution |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`skill-extract.mjs`** (#1896) | Single source of truth for hard skill recognition, case sensitivity, and canonical aliases. | Free-text string (CV, JD, gap notes). | `Set<string>` of canonical skill names. | **Token Recognition:** Both need to identify hard skills. | **Direct Reuse:** AI Skill Proof Builder imports `extractSkills()` and `canonicalize()` directly. Zero tokenizer duplication. |
| **`jd-skill-gap.mjs`** | Zero-LLM regex extraction of required skills from JDs; classifies vs `cv.md`. | Target JD text and `cv.md`. | Three-bucket list: `existing`, `supportedByResume`, `gap`. | **JD Skill Extraction:** Both extract skills from job descriptions. | **Direct Reuse & Extension:** AI Skill Proof Builder reuses `extractJdSkills()` to parse JD requirement blocks. Whereas `jd-skill-gap.mjs` only checks if the skill exists as a word in `cv.md`, Skill Proof Builder audits whether the skill is backed by code in GitHub. |
| **`github-evidence.mjs`** (#5295) | Optional GitHub evidence step for `expand` mode; checks user-authored PRs and commits. | User GitHub username via `gh` CLI. | `output/github-evidence-{date}.json` (PR and commit counts). | **GitHub Data Access:** Both interact with GitHub via `gh` CLI. | **Distinct Responsibility:** `github-evidence.mjs` counts PRs and commits authored by the user to discover unmentioned projects. It does **not** inspect dependency manifests or evaluate skill proficiency. Skill Proof Builder inspects manifests and maps evidence to specific skills. Reuses `defaultGhRunner()`, `normalizeGithubUser()`, and `readPrivateAllowlist()`. |
| **`evidence-freshness.mjs`** | Determines whether the last GitHub evidence scan is stale (>30 days or >5 merged PRs) before running `oferta`. | `config/profile.yml` and `output/github-evidence-*.json`. | JSON on stdout (`{ stale: boolean, daysOld, newPrs }`). | **Freshness Signal:** Both deal with GitHub scan age. | **Complementary Integration:** Skill Proof Builder updates the evidence scan, which in turn refreshes the signal evaluated by `evidence-freshness.mjs`. |
| **`modes/expand.md`** | Auto-discovers missing projects/competencies from GitHub and proposes adding them to `cv.md`. | GitHub profile, REST API, portfolio URL. | Proposal table for `add-entry.mjs` (`Projects`, `Publications`). | **Competency Discovery:** Both read GitHub repos. | **Distinct Workflow:** `expand` asks: *"What projects did you build that are missing from your CV?"* and adds text to `cv.md`. Skill Proof Builder asks: *"For the skills on your CV and in the JD, do your repos actually prove working competence?"* It does not edit `cv.md`. |
| **`upskill.mjs` / `modes/upskill.md`** | Aggregates missing skill gaps across evaluated tracker reports to suggest what to learn. | Tracked evaluation reports in `reports/`. | Gap heatmap table and web-searched learning plan. | **Skill Gap Analysis:** Both identify missing technical competencies. | **Macro vs. Micro Focus:** `upskill` looks backwards across 20+ historical application rejections to answer *"What skills am I missing across my entire job search?"*. Skill Proof Builder evaluates a single job and current repositories to answer *"Do my current codebases prove the skills I claim right now?"*. |
| **`modes/project.md`** | Evaluates portfolio project viability on 6 dimensions (Signal, Uniqueness, Demo ability, Metrics, MVP time, STAR). | Project URL and description. | 6-dimension score (1–5) and BUILD / SKIP / PIVOT verdict. | **Project Evaluation:** Both evaluate technical projects. | **Strategic vs. Audit Scope:** `project` evaluates whether an idea is worth building as a portfolio showcase. Skill Proof Builder audits an *already built* codebase to verify which technical skills it proves. |
| **`verify-cv-facts.mjs`** | Verifies that factual statements and numbers in `cv.md` match `config/cv-facts.json`. | `cv.md` and `config/cv-facts.json`. | Fact-check pass/fail verdict. | **Fact Checking:** Both prevent resume embellishment. | **Internal vs. External:** `verify-cv-facts.mjs` verifies internal consistency (CV text matches user facts). Skill Proof Builder verifies external technical proof (CV skills match public repository code). |
| **`career-profile.mjs`** | Maintains source-backed Master Career Profile with quote-level line citations. | `cv.md` and `data/career-profile.yml`. | Structured profile with verified candidate facts. | **Claim Provenance:** Both track where a candidate claim originates. | **Data Source:** Skill Proof Builder consumes `data/career-profile.yml` and `cv.md` as verified supply-side sources of candidate claims. |

---

## 3. Evidence Quality Hierarchy

To eliminate ambiguity in skill assessment, the proposal establishes a four-tier evidence quality hierarchy:

1. **Dependency Manifest Declaration (e.g. `package.json`, `requirements.txt`):**
   - *Nature:* Declarative intent to use a package.
   - *Limitation:* Adding a dependency does not prove the candidate wrote code using it.
   - *Rule:* **Cannot qualify as `STRONG_EVIDENCE` alone.** Capped at `PARTIAL_EVIDENCE`.
2. **Documentation Mention (e.g. `README.md`, docs):**
   - *Nature:* Contextual narrative or architectural description.
   - *Limitation:* READMEs often describe roadmaps, generic features, or tutorial boilerplate.
   - *Rule:* **Cannot qualify as `STRONG_EVIDENCE` alone.** Capped at `PARTIAL_EVIDENCE`.
3. **Source Code Implementation (e.g. imports and calls in source files):**
   - *Nature:* Concrete practical invocation of the technology.
   - *Limitation:* A single, trivial one-line call is shallow evidence.
   - *Rule:* Qualifies as `PARTIAL_EVIDENCE` if isolated/shallow; can elevate to `STRONG_EVIDENCE` when integrated into application workflows.
4. **Demonstrated Meaningful Implementation & Verification:**
   - *Nature:* Multi-component architectural integration, substantive domain/business logic, implementation context, and automated unit/integration tests directly exercising the technology.
   - *Rule:* **Qualifies for `STRONG_EVIDENCE`**. *(A configuration file alone, e.g. a basic Dockerfile or config.yaml, or a manifest/README mention alone CANNOT qualify).*

---

## 4. Execution Architecture Separation

To keep Career-Ops local-first, lightweight, and AI-agnostic, the execution architecture is split into two cleanly separated tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TWO-TIER EXECUTION SPLIT                        │
├──────────────────────────────────┬─────────────────────────────────────┤
│ A. AI AGENT MODE                 │ B. STANDALONE CLI                   │
│    modes/skill-proof.md          │    skill-proof.mjs                  │
├──────────────────────────────────┼─────────────────────────────────────┤
│ • Interactive AI Coding CLIs     │ • Local terminal / CI pipelines     │
│ • Claude, Antigravity, OpenCode  │ • Zero-LLM deterministic execution  │
│ • Qualitative prompt evaluation  │ • Heuristic rule-based scoring      │
│ • Conversational guidance        │ • Zero token cost                   │
│ • Code improvement drafting      │ • Structured JSON & Markdown reports│
└──────────────────────────────────┴─────────────────────────────────────┘
```

- **`modes/skill-proof.md`:** The AI agent prompt mode designed for interactive environments. It performs deep qualitative reasoning over structured evidence excerpts, evaluates nuanced architectural trade-offs, and provides interactive guidance.
- **`skill-proof.mjs`:** The standalone root executable script. It is 100% deterministic and runs **without invoking any LLM**. It handles skill extraction, repository evidence collection, manifest parsing, bounded source extraction, heuristic rule-based grading, and report writing.

---

## 5. GitHub Security Architecture

The integration follows the strict security conventions established by `github-evidence.mjs`:
1. **Safe Process Execution:** `defaultGhRunner(args)` uses `spawnSync('gh', args, { shell: false })` with direct argument arrays. No shell string interpolation is permitted, eliminating command injection vulnerabilities.
2. **Public Repository Access:** Fetches public repositories via `gh api` or the unauthenticated GitHub REST API (`api.github.com`).
3. **Private Repository Protection:** Strictly requires explicit opt-in in `config/profile.yml` (`github_evidence.private_allowlist`). Unlisted private repositories are never accessed.
4. **Rate Limit Handling:** Reads `x-ratelimit-remaining`; halts when fewer than 5 requests remain; marks unqueried repositories as `UNABLE_TO_VERIFY (rate_limited)`.
5. **Bounded Network Footprint:** Hard ceilings: max 15 repos, max 6,000 chars per README (matching `MAX_README_LENGTH` from `github-evidence.mjs`), max 5 source files per repo, max 50 KB per file.
6. **Zero Code Execution:** The system never runs `npm install`, `pip install`, `eval()`, or `child_process.exec()` on repository code.
7. **Untrusted Content Protocol & Prompt Injection Defense:** All external repository text is treated strictly as untrusted data (`AGENTS.md`). XML tags (`<untrusted_evidence_content>`) delineate structural boundaries but are **not a standalone security guarantee**. Security relies on zero code execution, explicit system directives forbidding the model from following embedded instructions or overrides, rigid output schema validation, and human review. Repository content is never permitted to override system prompts or scoring rules.

---

## 6. Conclusion & Non-Duplication Guarantee

The proposed AI Skill Proof Builder does not duplicate any existing feature in Career-Ops:
1. **It fills a clear, unaddressed gap:** Evaluating the depth of implementation evidence for claimed skills.
2. **It reuses existing primitives:** Imports `skill-extract.mjs`, `extractJdSkills` from `jd-skill-gap.mjs`, and adheres to the `github-evidence.mjs` security conventions.
3. **It respects existing boundaries:** Never edits `cv.md`, never duplicates scoring in `oferta.md`, and never introduces parallel tokenizers.
