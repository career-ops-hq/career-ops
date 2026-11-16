# 04 — System Architecture & Component Design

## 1. Architectural Philosophy & Context

The **AI Skill Proof Builder** is designed as a native, local-first extension to Career-Ops. It adheres to the established architectural doctrine of the project:
1. **Zero New Daemons / Servers:** No background Node or Python web services. Logic executes on demand via CLI or through AI prompt modes.
2. **Flat-Root Script Pattern:** Core CLI utilities reside in the repository root (`skill-proof.mjs`) alongside modular libraries in `lib/` (`lib/skill-proof-*.mjs`).
3. **Decoupled Deterministic & AI Layers:** Evidence collection, manifest parsing, and skill tokenization are 100% deterministic, dependency-free, and unit-testable. The AI layer is reserved purely for qualitative evidence evaluation and recommendation synthesis.

---

## 2. High-Level Architecture Diagram

```mermaid
flowchart TD
    subgraph Inputs ["1. Input Layer (Local / User Files)"]
        CV["cv.md / profile.yml<br>(Candidate Skills)"]
        JD["Job Description Text / URL<br>(Target Requirements)"]
        CONF["config/profile.yml<br>(GitHub User, Allowlist)"]
    end

    subgraph ModuleA ["2. Module A: Skill Extraction Engine"]
        EXT_CAN["skill-extract.mjs<br>(Canonical Tokenizer)"]
        EXT_JD["jd-skill-gap.mjs<br>(extractJdSkills)"]
        SKILL_MAP["Skill Normalizer & Categorizer"]
    end

    subgraph ModuleB ["3. Module B: Evidence Collection Engine"]
        GH_DISC["GitHub Discovery<br>(gh CLI / Public REST API)"]
        MAN_PARSE["Manifest Parser<br>(package.json, pyproject, etc.)"]
        DOC_FETCH["README & Bounded Source Fetcher<br>(Sanitized & Capped)"]
    end

    subgraph ModuleC ["4. Module C: Skill-Evidence Mapping"]
        MAP_CORE["lib/skill-proof-mapper.mjs<br>(Many-to-Many Correlation Engine)"]
    end

    subgraph ModuleD ["5. Module D: Evidence Evaluation Engine (Unified Component)"]
        CLI_PATH["Standalone CLI Path (skill-proof.mjs)<br>Deterministic Heuristic Evaluator (Zero-LLM)"]
        AGENT_PATH["AI Agent Mode Path (modes/skill-proof.md)<br>AI-Assisted Qualitative Evaluator (Agentic)"]
        TIERS["4 Assessment Tiers:<br>Strong / Partial / No Evidence / Unable to Verify"]
    end

    subgraph ModuleE ["6. Module E: Recommendation & Reporting"]
        REC_GEN["Recommendation Engine<br>(Actionable Upgrade Tactics)"]
        REP_GEN["Report Writer<br>(Consistent Schema Generator)"]
    end

    subgraph Outputs ["7. Output Layer (User Layer: data/skill-proof/)"]
        OUT_MD["report-{company}-{date}.md<br>(Human Audit Report)"]
        OUT_JSON["report-{company}-{date}.json<br>(Machine-Readable Manifest)"]
    end

    CV --> EXT_CAN
    JD --> EXT_JD
    EXT_CAN --> SKILL_MAP
    EXT_JD --> SKILL_MAP

    CONF --> GH_DISC
    GH_DISC --> MAN_PARSE
    GH_DISC --> DOC_FETCH

    SKILL_MAP --> MAP_CORE
    MAN_PARSE --> MAP_CORE
    DOC_FETCH --> MAP_CORE

    MAP_CORE --> CLI_PATH
    MAP_CORE --> AGENT_PATH

    CLI_PATH --> TIERS
    AGENT_PATH --> TIERS

    TIERS --> REC_GEN
    REC_GEN --> REP_GEN
    REP_GEN --> OUT_MD
    REP_GEN --> OUT_JSON
```

---

## 3. Detailed Component Architecture

### 3.1 Component 1: Skill Extraction Component (`lib/skill-proof-extractor.mjs`)
- **Responsibility:** Ingests raw text from JDs and candidate resumes, identifies skill tokens, normalizes them against the canonical dictionary, and assigns categories.
- **Input:**
  - `jdText` (string)
  - `cvText` (string)
  - `profile` (object, from `config/profile.yml`)
- **Output:**
  - `ExtractedSkillsBundle` (`{ requiredSkills: Skill[], claimedSkills: Skill[], targetRole: string }`)
- **Dependencies:**
  - `skill-extract.mjs` (`extractSkills`, `canonicalize`, `SKILL_PATTERN`)
  - `jd-skill-gap.mjs` (`scanJd`, `STOPWORDS`)
- **Error Conditions:**
  - Empty input text → returns empty skill sets with diagnostic warnings.
  - CJK or non-Latin requirement headers → processed using `scanJd()` multilingual regex.

### 3.2 Component 2: GitHub Integration Component (`lib/skill-proof-github.mjs`)
- **Responsibility:** Interacts with GitHub safely to discover repositories, fetch metadata, read dependency manifests, and retrieve README content without executing code.
- **Input:**
  - `username` (string, normalized GitHub user)
  - `options` (`{ privateAllowlist: string[], since: string, skipReadmes: boolean }`)
- **Output:**
  - `RepositoryEvidence[]` (list of repo objects with metadata, parsed manifests, and sanitized READMEs)
- **Dependencies:**
  - `child_process` (for executing `gh api` when available)
  - Node.js native `fetch` (for public REST API fallback)
  - `lib/yaml-document.mjs` (for parsing YAML manifests)
- **Error Conditions:**
  - Rate limiting (HTTP 403/429) → returns partial evidence with `rateLimited: true`.
  - Non-existent user → exits gracefully with diagnostic error code 1.
  - Network disconnection → gracefully falls back to local cached data or returns error code 2.

### 3.3 Component 3: Evidence Normalization Component (`lib/skill-proof-manifests.mjs`)
- **Responsibility:** Parses raw manifest files across diverse package ecosystems and normalizes dependency names into canonical skill names.
- **Input:**
  - Raw manifest file contents (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `Dockerfile`, etc.)
- **Output:**
  - `NormalizedDependencies` (`{ directDependencies: Set<string>, devDependencies: Set<string>, buildTools: Set<string> }`)
- **Dependencies:**
  - Standard JSON parser (`JSON.parse`)
  - Lightweight regex parsers for Python, Go, Rust, and Dockerfiles.
- **Error Conditions:**
  - Malformed `package.json` → logs warning, attempts regex fallback, does not crash.

### 3.4 Component 4: Skill-Evidence Mapping Component (`lib/skill-proof-mapper.mjs`)
- **Responsibility:** Builds the Many-to-Many correlation matrix between normalized skills and collected evidence items.
- **Input:**
  - `ExtractedSkillsBundle` (from Component 1)
  - `RepositoryEvidence[]` (from Component 2)
- **Output:**
  - `SkillEvidenceMatrix` (`Map<SkillName, EvidenceItem[]>`)
- **Dependencies:**
  - `lib/skill-proof-extractor.mjs`
- **Error Conditions:**
  - Zero matching evidence found → marks skill mapping as `unmapped`.

### 3.5 Component 5: Evidence Evaluation Component (`modes/skill-proof.md` & `lib/skill-proof-evaluator.mjs`)
- **Responsibility:** Evaluates mapped evidence against the four standardized assessment tiers (`STRONG_EVIDENCE`, `PARTIAL_EVIDENCE`, `NO_EVIDENCE_FOUND`, `UNABLE_TO_VERIFY`).
- **Two Execution Paths:**
  1. **AI Agent Mode (`modes/skill-proof.md`):** Used during interactive sessions with AI coding CLIs (Claude Code, Antigravity, OpenCode, Codex, Pi, Qwen). Performs qualitative reasoning over structured evidence excerpts inside `<untrusted_evidence_content>` XML tags.
  2. **Standalone CLI Heuristic (`lib/skill-proof-evaluator.mjs`):** Executed by `skill-proof.mjs` in local terminal runs and CI test suites. Runs **100% deterministically without an LLM** using a verified rule-based scoring engine (evaluating manifest presence, language bytes, and bounded source file evidence).
- **Input:**
  - `SkillEvidenceMatrix` (from Component 4)
  - Target role and candidate claim metadata
- **Output:**
  - Consistent JSON assessment bundle: `{ assessments: [{ skill, category, assessment_tier, confidence, reasoning, supporting_evidence }] }`
- **Dependencies:**
  - `lib/skill-proof-evaluator.mjs` (for deterministic heuristic scoring and schema validation).
- **Error Conditions:**
  - Malformed AI JSON response → caught by schema validator; triggers one correction attempt or falls back to deterministic heuristic grading.

### 3.6 Component 6: Recommendation & Reporting Component (`lib/skill-proof-reporter.mjs`)
- **Responsibility:** Synthesizes evaluation results, generates actionable upgrade tactics for partial/missing skills, and formats Markdown and JSON reports.
- **Input:**
  - Evaluated skill proof bundle and target job metadata.
- **Output:**
  - `data/skill-proof/report-{company-slug}-{date}.md`
  - `data/skill-proof/report-{company-slug}-{date}.json`
- **Dependencies:**
  - `fs`, `path`
  - `path-resolver.mjs` (ensuring outputs land in the User Layer data root).
- **Error Conditions:**
  - Unwritable output directory → creates missing directory under `{DATA_ROOT}/data/skill-proof/`.

---

## 4. Sequence Diagrams

### 4.1 Evidence Collection & Normalization Sequence
```mermaid
sequenceDiagram
    autonumber
    participant Runner as skill-proof.mjs
    participant Resolver as path-resolver.mjs
    participant GH as GitHub Integrator
    participant Manifests as Manifest Normalizer
    participant Cache as data/cache/github/

    Runner->>Resolver: getCareerOpsRoot()
    Resolver-->>Runner: Data root path
    Runner->>GH: collectEvidence(username, allowlist)
    GH->>GH: Check local 'gh auth status'
    alt gh CLI is authenticated
        GH->>GH: gh api /users/{user}/repos
    else gh is not available
        GH->>GH: fetch(https://api.github.com/users/{user}/repos)
    end
    GH-->>Runner: Public & allowlisted repos list
    loop For each repository (up to max 15 repos)
        GH->>GH: Check if repo is fork
        opt Not a fork
            GH->>GH: Fetch package manifests (package.json, requirements.txt)
            GH->>Manifests: parseManifest(content, type)
            Manifests-->>GH: Normalized dependencies
            GH->>GH: Fetch README.md (truncated at 8KB)
        end
    end
    GH->>Cache: Save repository evidence bundle
    GH-->>Runner: RepositoryEvidence[]
```

---

### 4.2 Skill Evaluation Sequence
```mermaid
sequenceDiagram
    autonumber
    participant CLI as AI Agent / Evaluator
    participant Mapper as skill-proof-mapper.mjs
    participant Prompt as Prompt Assembler
    participant Model as LLM / Heuristic Engine
    participant Reporter as skill-proof-reporter.mjs
    participant FS as Local File System

    CLI->>Mapper: mapSkillsToEvidence(skills, repoEvidence)
    Mapper-->>CLI: SkillEvidenceMatrix
    loop For each required/claimed skill
        CLI->>Prompt: assembleSkillPrompt(skill, mappedEvidence)
        Prompt-->>CLI: Structured evaluation context (<untrusted_evidence>)
        CLI->>Model: Execute evaluation prompt
        Model-->>CLI: Structured JSON response {tier, reasoning, confidence}
        CLI->>CLI: Validate JSON against AssessmentSchema
    end
    CLI->>Reporter: buildReport(evaluations, metadata)
    Reporter->>Reporter: Generate actionable upgrade recommendations
    Reporter->>FS: Atomic write data/skill-proof/report-{company}-{date}.md
    Reporter->>FS: Atomic write data/skill-proof/report-{company}-{date}.json
    Reporter-->>CLI: Report file paths & executive summary
```

---

## 5. Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    CANDIDATE_PROFILE ||--o{ CLAIMED_SKILL : claims
    JOB_REQUIREMENT ||--o{ REQUIRED_SKILL : demands
    CLAIMED_SKILL ||--o{ SKILL_EVIDENCE_MAPPING : maps_to
    REQUIRED_SKILL ||--o{ SKILL_EVIDENCE_MAPPING : evaluated_in
    EVIDENCE_ITEM ||--o{ SKILL_EVIDENCE_MAPPING : supports
    REPOSITORY ||--o{ EVIDENCE_ITEM : contains
    SKILL_EVIDENCE_MAPPING ||--|| EVIDENCE_ASSESSMENT : evaluated_as
    EVIDENCE_ASSESSMENT ||--o{ RECOMMENDATION : triggers
    SKILL_PROOF_REPORT ||--o{ EVIDENCE_ASSESSMENT : compiles

    CANDIDATE_PROFILE {
        string candidate_id
        string name
        string github_username
        string portfolio_url
    }

    CLAIMED_SKILL {
        string skill_id
        string canonical_name
        string category
        string source_file
        int source_line
    }

    JOB_REQUIREMENT {
        string job_id
        string company
        string role_title
        string source_url
    }

    REQUIRED_SKILL {
        string skill_id
        string canonical_name
        string category
        string importance
    }

    REPOSITORY {
        string repo_id
        string full_name
        boolean is_fork
        boolean is_private
        int star_count
        string primary_language
    }

    EVIDENCE_ITEM {
        string evidence_id
        string repo_id
        string evidence_type
        string file_path
        string content_digest
    }

    SKILL_EVIDENCE_MAPPING {
        string mapping_id
        string skill_name
        string evidence_id
        float initial_weight
    }

    EVIDENCE_ASSESSMENT {
        string assessment_id
        string skill_name
        string tier
        string confidence
        string reasoning
    }

    RECOMMENDATION {
        string rec_id
        string skill_name
        string current_tier
        string target_tier
        string action_summary
        string code_example
    }

    SKILL_PROOF_REPORT {
        string report_id
        string generated_at
        string target_company
        string target_role
        int strong_count
        int partial_count
        int gap_count
    }
```
