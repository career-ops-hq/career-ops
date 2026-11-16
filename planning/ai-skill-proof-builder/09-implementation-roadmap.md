# 09 — File-Level Implementation Plan & Phased Roadmap

## 1. File-Level Implementation Plan

The file-level plan strictly respects Career-Ops conventions:
- Flat root for standalone CLI executable scripts (`*.mjs`).
- Modular helper logic in `lib/` (`lib/*.mjs`).
- Prompt workflows in `modes/` (`modes/*.md`).
- Multi-CLI routing entry in `.agents/skills/career-ops/SKILL.md`.
- Test suites in `tests/` (`tests/*.test.mjs`).
- User outputs confined to `data/skill-proof/`.

```
career-ops/
├── skill-proof.mjs                              # Proposed Root CLI Executable (Main Entrypoint)
├── modes/
│   └── skill-proof.md                           # Proposed Agent Prompt Mode
├── lib/
│   ├── skill-proof-extractor.mjs                # Proposed: Skill extraction, normalization & taxonomy
│   ├── skill-proof-github.mjs                   # Proposed: Safe GitHub discovery, metadata & manifest fetching
│   ├── skill-proof-manifests.mjs                # Proposed: Multi-language package manifest parsers
│   ├── skill-proof-mapper.mjs                   # Proposed: Many-to-Many skill-evidence correlation matrix
│   ├── skill-proof-evaluator.mjs                # Proposed: Rubric grading & deterministic heuristic engine
│   └── skill-proof-reporter.mjs                 # Proposed: Markdown and JSON report generator
├── tests/
│   ├── skill-proof-manifests.test.mjs           # Proposed: Manifest parsing tests
│   ├── skill-proof-extractor.test.mjs           # Proposed: Skill extraction & canonicalization tests
│   ├── skill-proof-mapper.test.mjs              # Proposed: Mapping matrix tests
│   ├── skill-proof-evaluator.test.mjs           # Proposed: Assessment tier rubric tests
│   ├── skill-proof-schemas.test.mjs             # Proposed: JSON Schema validation tests
│   ├── skill-proof-github-mock.test.mjs         # Proposed: GitHub API & gh CLI mock integration tests
│   ├── skill-proof-security.test.mjs            # Proposed: Security & prompt injection tests
│   └── skill-proof-e2e.test.mjs                 # Proposed: Full pipeline end-to-end test
├── docs/
│   └── SKILL_PROOF.md                           # Proposed: Feature documentation & user guide
└── [Existing Files for Minimal Updates]
    ├── modes/README.md                          # Add skill-proof mode to catalog table
    ├── lib/update-manifest.mjs                  # Register new system files in SYSTEM_PATHS
    ├── AGENTS.md                                # Add skill-proof to Skill Modes routing table
    └── .agents/skills/career-ops/SKILL.md       # Expose /career-ops skill-proof
```

---

## 2. Inventory of Existing Files Reused vs. Proposed Files

### 2.1 Existing Files Reused Verbatim (Zero Modification)
- `skill-extract.mjs`: Primary canonical tokenizer, alias dictionary (`CANONICAL`), and boundary checkers.
- `jd-skill-gap.mjs`: Requirement section regex patterns (`REQUIREMENT_HEADER_RE`) and stopwords list (`STOPWORDS`).
- `path-resolver.mjs`: `getCareerOpsRoot()` for dynamic User Layer data root resolution.
- `lib/yaml-document.mjs`: Safe YAML parser for reading `config/profile.yml`.
- `lib/cli-flags.mjs`: Flag parsing utilities (`hasFlag`, `flagValue`, `validateFlags`).
- `utils/token-tracker.mjs`: Token consumption metrics tracking.
- `utils/privacy-filter.mjs`: PII redaction for prompts.
- `tests/helpers.mjs`: Test assertions (`pass`, `fail`, `ROOT`, `NODE`).

### 2.2 Existing Files Requiring Minimal System Updates
*(Note: These updates will be applied only during the actual implementation phase with maintainer approval)*
1. `lib/update-manifest.mjs`: Register proposed system files in `SYSTEM_PATHS` so that `node update-system.mjs apply` includes them in downstream releases:
   - `'skill-proof.mjs'`
   - `'modes/skill-proof.md'`
   - `'lib/skill-proof-extractor.mjs'`
   - `'lib/skill-proof-github.mjs'`
   - `'lib/skill-proof-manifests.mjs'`
   - `'lib/skill-proof-mapper.mjs'`
   - `'lib/skill-proof-evaluator.mjs'`
   - `'lib/skill-proof-reporter.mjs'`
   - `'docs/SKILL_PROOF.md'`
2. `modes/README.md`: Register `skill-proof.md` in the Mode Catalog table:
   `| skill-proof.md | skill-proof | AI-powered technical skill proof audit and repository evidence builder |`
3. `AGENTS.md` & `.agents/skills/career-ops/SKILL.md`: Add routing rule:
   `| "skill-proof", "proof", "verify skills", "audit portfolio" | skill-proof | modes/skill-proof.md |`

---

## 3. Phased Sprint Roadmap (MVP)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MVP IMPLEMENTATION SPRINTS                      │
├───────────┬───────────────────────────────────┬────────────────────────┤
│ Sprint 1  │ Extraction & Normalization Core   │ Module A, Manifests    │
├───────────┼───────────────────────────────────┼────────────────────────┤
│ Sprint 2  │ Safe GitHub Evidence Collection   │ Module B, Mapping (C)  │
├───────────┼───────────────────────────────────┼────────────────────────┤
│ Sprint 3  │ AI Evaluation & Prompt Mode       │ Module D (Tiers)       │
├───────────┼───────────────────────────────────┼────────────────────────┤
│ Sprint 4  │ Recommendations, Report & Tests   │ Module E, Docs, PR     │
└───────────────────────────┴───────────────────┴────────────────────────┘
```

### Sprint 1: Extraction & Manifest Normalization Core
- **Tasks:**
  1. Implement `lib/skill-proof-manifests.mjs` to parse `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, and `Dockerfile`.
  2. Implement `lib/skill-proof-extractor.mjs` importing `skill-extract.mjs` and `jd-skill-gap.mjs`.
  3. Create `tests/skill-proof-manifests.test.mjs` and `tests/skill-proof-extractor.test.mjs`.
- **Deliverable:** Working deterministic extraction pipeline verified by passing unit tests.

### Sprint 2: Safe GitHub Evidence Collection & Mapping
- **Tasks:**
  1. Implement `lib/skill-proof-github.mjs` with dual-mode support (`gh` CLI + zero-key public REST API).
  2. Implement rate-limiting guards and private repository allowlist filtering.
  3. Implement `lib/skill-proof-mapper.mjs` to construct the Many-to-Many correlation matrix.
  4. Create `tests/skill-proof-github-mock.test.mjs` and `tests/skill-proof-mapper.test.mjs`.
- **Deliverable:** Safe evidence retrieval and mapping engine verified with network mocking fixtures.

### Sprint 3: AI Evidence Evaluation Engine & Mode
- **Tasks:**
  1. Author `modes/skill-proof.md` containing evaluation prompt, rubric, and XML injection containment.
  2. Implement `lib/skill-proof-evaluator.mjs` containing the deterministic fallback algorithm and JSON response validator.
  3. Create `tests/skill-proof-evaluator.test.mjs` and `tests/skill-proof-security.test.mjs`.
- **Deliverable:** Complete evaluation pipeline capable of grading evidence into the 4 assessment tiers.

### Sprint 4: Recommendations, Reporting & Upstream PR Readiness
- **Tasks:**
  1. Implement `lib/skill-proof-reporter.mjs` generating Markdown and JSON reports.
  2. Implement root executable `skill-proof.mjs` supporting all CLI flags (`--jd`, `--github`, `--json`, `--summary`, `--self-test`).
  3. Create `tests/skill-proof-schemas.test.mjs` and `tests/skill-proof-e2e.test.mjs`.
  4. Author documentation in `docs/SKILL_PROOF.md`.
  5. Run full test suite via `node test-all.mjs` ensuring 100% green status across all existing and new tests.
- **Deliverable:** Production-grade contribution ready for Pull Request submission.

---

## 4. Maintainer Contribution Checklist

Before submitting the Pull Request to `career-ops-hq/career-ops`, the implementation must satisfy every item on this checklist:

- [ ] **Data Contract Compliance:** No system files overlap with `USER_PATHS`. All user outputs are strictly isolated in `data/skill-proof/`.
- [ ] **Zero Native Dependencies:** No external npm dependencies added to `package.json`.
- [ ] **Confirm-Before-Write Rule:** The tool does not automatically edit `cv.md` or candidate files.
- [ ] **Untrusted Input Security:** All external repository data wrapped in `<untrusted_evidence_content>` tags. Zero arbitrary code execution.
- [ ] **Hermetic Testing:** Every test in `tests/skill-proof-*.test.mjs` passes without network access and without requiring API keys.
- [ ] **Test Runner Invariants:** No test suite calls `process.exit()` or `finish()`. All tests use `pass()` / `fail()` from `tests/helpers.mjs`.
- [ ] **Update Manifest Sync:** All new system files registered in `SYSTEM_PATHS` in `lib/update-manifest.mjs`.
- [ ] **Lint & Syntax:** `npm run lint` (`node scripts/check-syntax.mjs`) passes cleanly with zero syntax or style errors.
