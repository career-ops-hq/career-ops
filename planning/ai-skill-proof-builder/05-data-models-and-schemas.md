# 05 — Data Models & Schemas

## 1. Data Architecture & Storage Doctrine

In strict accordance with Career-Ops settled doctrine (`ARCHITECTURE.md` and `DATA_CONTRACT.md`):
1. **Files are Primary — Databases are Derived:** All data entities in the AI Skill Proof Builder are represented as human-readable, git-diffable JSON and Markdown files stored locally in the User Layer (`data/skill-proof/`).
2. **Schema Versioning:** Every JSON artifact carries an explicit `schema_version` (e.g. `skill-proof.v1`) to ensure forwards and backwards compatibility across releases.
3. **Immutability of Historical Audits:** Each evaluation produces a timestamped report file (`data/skill-proof/report-{company-slug}-{YYYY-MM-DD}.json` and `.md`), allowing the candidate to track evidence improvement over time without overwriting past audits.

---

## 2. JSON Schemas & Data Models

### 2.1 Schema 1: Extracted Skills Bundle (`extracted-skills.v1`)
Represents the combined set of demand-side (JD) and supply-side (CV/Profile) skills.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ExtractedSkillsBundle",
  "type": "object",
  "required": ["schema_version", "target_job", "candidate_skills", "job_skills", "comparison"],
  "properties": {
    "schema_version": { "type": "string", "enum": ["extracted-skills.v1"] },
    "extracted_at": { "type": "string", "format": "date-time" },
    "target_job": {
      "type": "object",
      "required": ["company", "role_title"],
      "properties": {
        "company": { "type": "string" },
        "role_title": { "type": "string" },
        "source_url": { "type": ["string", "null"] },
        "jd_file": { "type": ["string", "null"] }
      }
    },
    "candidate_skills": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["canonical_name", "category", "source_file"],
        "properties": {
          "canonical_name": { "type": "string" },
          "raw_token": { "type": "string" },
          "category": { 
            "type": "string",
            "enum": ["languages", "frameworks", "databases", "cloud_devops", "ai_ml", "testing_qa", "methodologies_tools", "other"]
          },
          "source_file": { "type": "string" },
          "source_line": { "type": ["integer", "null"] },
          "provenance_snippet": { "type": "string" }
        }
      }
    },
    "job_skills": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["canonical_name", "category", "requirement_tier"],
        "properties": {
          "canonical_name": { "type": "string" },
          "raw_token": { "type": "string" },
          "category": { "type": "string" },
          "requirement_tier": { "type": "string", "enum": ["mandatory", "preferred", "unspecified"] },
          "context_line": { "type": "string" }
        }
      }
    },
    "comparison": {
      "type": "object",
      "required": ["matched", "unmatched_gaps", "candidate_extra"],
      "properties": {
        "matched": { "type": "array", "items": { "type": "string" } },
        "unmatched_gaps": { "type": "array", "items": { "type": "string" } },
        "candidate_extra": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

#### Example Instance:
```json
{
  "schema_version": "extracted-skills.v1",
  "extracted_at": "2026-11-17T10:00:00Z",
  "target_job": {
    "company": "Acme Robotics",
    "role_title": "Senior Backend Engineer",
    "source_url": "https://acme.com/jobs/42",
    "jd_file": "jds/acme-robotics.md"
  },
  "candidate_skills": [
    {
      "canonical_name": "Python",
      "raw_token": "python",
      "category": "languages",
      "source_file": "cv.md",
      "source_line": 28,
      "provenance_snippet": "- Engineered high-throughput ingestion pipelines in Python and FastAPI."
    },
    {
      "canonical_name": "PostgreSQL",
      "raw_token": "Postgres",
      "category": "databases",
      "source_file": "cv.md",
      "source_line": 32,
      "provenance_snippet": "- Optimized PostgreSQL query performance, reducing p99 latency by 45%."
    }
  ],
  "job_skills": [
    {
      "canonical_name": "Python",
      "raw_token": "Python 3.11+",
      "category": "languages",
      "requirement_tier": "mandatory",
      "context_line": "5+ years of production experience in Python"
    },
    {
      "canonical_name": "Kubernetes",
      "raw_token": "k8s",
      "category": "cloud_devops",
      "requirement_tier": "mandatory",
      "context_line": "Experience orchestrating containers via Kubernetes or Helm"
    }
  ],
  "comparison": {
    "matched": ["Python", "PostgreSQL"],
    "unmatched_gaps": ["Kubernetes"],
    "candidate_extra": ["Redis", "Docker"]
  }
}
```

---

### 2.2 Schema 2: GitHub Evidence Catalog (`github-evidence-catalog.v1`)
Represents the collected repositories, manifests, and documentation.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "GitHubEvidenceCatalog",
  "type": "object",
  "required": ["schema_version", "username", "collected_at", "repositories"],
  "properties": {
    "schema_version": { "type": "string", "enum": ["github-evidence-catalog.v1"] },
    "username": { "type": "string" },
    "collected_at": { "type": "string", "format": "date-time" },
    "source_mode": { "type": "string", "enum": ["gh_cli", "public_rest_api", "local_cached"] },
    "rate_limit_remaining": { "type": ["integer", "null"] },
    "repositories": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["repo_id", "name", "full_name", "url", "is_fork", "is_private"],
        "properties": {
          "repo_id": { "type": "string" },
          "name": { "type": "string" },
          "full_name": { "type": "string" },
          "url": { "type": "string" },
          "is_fork": { "type": "boolean" },
          "is_private": { "type": "boolean" },
          "stars": { "type": "integer" },
          "primary_language": { "type": ["string", "null"] },
          "language_breakdown": {
            "type": "object",
            "additionalProperties": { "type": "integer" }
          },
          "pushed_at": { "type": "string" },
          "manifests": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["file_name", "manifest_type", "dependencies"],
              "properties": {
                "file_name": { "type": "string" },
                "manifest_type": { "type": "string" },
                "dependencies": { "type": "array", "items": { "type": "string" } },
                "dev_dependencies": { "type": "array", "items": { "type": "string" } }
              }
            }
          },
          "readme": {
            "type": ["object", "null"],
            "properties": {
              "file_name": { "type": "string" },
              "char_length": { "type": "integer" },
              "summary_excerpt": { "type": "string" },
              "headings": { "type": "array", "items": { "type": "string" } }
            }
          }
        }
      }
    }
  }
}
```

---

### 2.3 Schema 3: Skill-Evidence Mapping Matrix (`skill-evidence-mapping.v1`)
Connects skills to evidence artifacts with preliminary heuristics.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SkillEvidenceMappingMatrix",
  "type": "object",
  "required": ["schema_version", "mappings"],
  "properties": {
    "schema_version": { "type": "string", "enum": ["skill-evidence-mapping.v1"] },
    "mappings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["skill_name", "category", "evidence_items"],
        "properties": {
          "skill_name": { "type": "string" },
          "category": { "type": "string" },
          "evidence_items": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["evidence_id", "repo_name", "evidence_type", "location"],
              "properties": {
                "evidence_id": { "type": "string" },
                "repo_name": { "type": "string" },
                "repo_url": { "type": "string" },
                "evidence_type": { 
                  "type": "string", 
                  "enum": ["dependency_manifest", "readme_section", "language_bytes", "source_file", "dockerfile"]
                },
                "location": { "type": "string" },
                "snippet_or_match": { "type": "string" },
                "signal_weight": { "type": "number", "minimum": 0.0, "maximum": 1.0 }
              }
            }
          }
        }
      }
    }
  }
}
```

---

### 2.4 Schema 4: Evidence Assessment & Recommendations (`skill-proof-report.v1`)
The complete, authoritative schema representing the evaluation output and report.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SkillProofReport",
  "type": "object",
  "required": [
    "schema_version",
    "metadata",
    "summary_metrics",
    "assessments",
    "recommendations",
    "limitations"
  ],
  "properties": {
    "schema_version": { "type": "string", "enum": ["skill-proof-report.v1"] },
    "metadata": {
      "type": "object",
      "required": ["generated_at", "candidate_name", "target_company", "target_role"],
      "properties": {
        "generated_at": { "type": "string", "format": "date-time" },
        "candidate_name": { "type": "string" },
        "github_username": { "type": "string" },
        "target_company": { "type": "string" },
        "target_role": { "type": "string" },
        "evaluator_type": { "type": "string", "enum": ["ai_agent", "gemini_eval", "openai_eval", "deterministic_heuristic"] }
      }
    },
    "summary_metrics": {
      "type": "object",
      "required": ["total_skills_evaluated", "strong_evidence_count", "partial_evidence_count", "no_evidence_count", "unable_to_verify_count"],
      "properties": {
        "total_skills_evaluated": { "type": "integer" },
        "strong_evidence_count": { "type": "integer" },
        "partial_evidence_count": { "type": "integer" },
        "no_evidence_count": { "type": "integer" },
        "unable_to_verify_count": { "type": "integer" },
        "evidence_coverage_ratio": { "type": "number" }
      }
    },
    "assessments": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["skill", "category", "assessment_tier", "confidence", "reasoning", "supporting_evidence"],
        "properties": {
          "skill": { "type": "string" },
          "category": { "type": "string" },
          "is_job_requirement": { "type": "boolean" },
          "is_candidate_claim": { "type": "boolean" },
          "assessment_tier": {
            "type": "string",
            "enum": ["STRONG_EVIDENCE", "PARTIAL_EVIDENCE", "NO_EVIDENCE_FOUND", "UNABLE_TO_VERIFY"]
          },
          "confidence": { "type": "string", "enum": ["HIGH", "MEDIUM", "LOW"] },
          "reasoning": { "type": "string" },
          "supporting_evidence": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["repo", "location", "evidence_type"],
              "properties": {
                "repo": { "type": "string" },
                "location": { "type": "string" },
                "evidence_type": { "type": "string" },
                "description": { "type": "string" }
              }
            }
          }
        }
      }
    },
    "recommendations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["skill", "current_tier", "priority", "upgrade_actions"],
        "properties": {
          "skill": { "type": "string" },
          "current_tier": { "type": "string" },
          "priority": { "type": "string", "enum": ["HIGH", "MEDIUM", "LOW"] },
          "upgrade_actions": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["action_summary", "concrete_steps"],
              "properties": {
                "action_summary": { "type": "string" },
                "concrete_steps": { "type": "array", "items": { "type": "string" } },
                "code_example_hint": { "type": ["string", "null"] }
              }
            }
          }
        }
      }
    },
    "limitations": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

#### Example Report JSON Instance:
```json
{
  "schema_version": "skill-proof-report.v1",
  "metadata": {
    "generated_at": "2026-11-17T10:05:00Z",
    "candidate_name": "Jane Smith",
    "github_username": "janesmith",
    "target_company": "Acme Robotics",
    "target_role": "Senior Backend Engineer",
    "evaluator_type": "ai_agent"
  },
  "summary_metrics": {
    "total_skills_evaluated": 4,
    "strong_evidence_count": 2,
    "partial_evidence_count": 1,
    "no_evidence_count": 1,
    "unable_to_verify_count": 0,
    "evidence_coverage_ratio": 0.75
  },
  "assessments": [
    {
      "skill": "Python",
      "category": "languages",
      "is_job_requirement": true,
      "is_candidate_claim": true,
      "assessment_tier": "STRONG_EVIDENCE",
      "confidence": "HIGH",
      "reasoning": "Demonstrated across multiple repositories with extensive implementation, tests, and package configurations.",
      "supporting_evidence": [
        {
          "repo": "janesmith/fire-detection-api",
          "location": "requirements.txt",
          "evidence_type": "dependency_manifest",
          "description": "Python 3.11 with FastAPI, OpenCV, and PyTorch dependencies."
        },
        {
          "repo": "janesmith/fire-detection-api",
          "location": "README.md",
          "evidence_type": "readme_section",
          "description": "Complete architecture documentation with API route diagrams."
        }
      ]
    },
    {
      "skill": "PostgreSQL",
      "category": "databases",
      "is_job_requirement": true,
      "is_candidate_claim": true,
      "assessment_tier": "PARTIAL_EVIDENCE",
      "confidence": "HIGH",
      "reasoning": "Package 'psycopg2' is declared in requirements.txt, but repository contains no schema definitions, migration files, or complex queries.",
      "supporting_evidence": [
        {
          "repo": "janesmith/inventory-system",
          "location": "requirements.txt",
          "evidence_type": "dependency_manifest",
          "description": "psycopg2-binary==2.9.9 listed in dependencies."
        }
      ]
    },
    {
      "skill": "Kubernetes",
      "category": "cloud_devops",
      "is_job_requirement": true,
      "is_candidate_claim": false,
      "assessment_tier": "NO_EVIDENCE_FOUND",
      "confidence": "HIGH",
      "reasoning": "Required by Acme Robotics JD, but no Kubernetes manifests, Helm charts, or k8s references exist in accessible public repositories.",
      "supporting_evidence": []
    }
  ],
  "recommendations": [
    {
      "skill": "PostgreSQL",
      "current_tier": "PARTIAL_EVIDENCE",
      "priority": "HIGH",
      "upgrade_actions": [
        {
          "action_summary": "Document database schema and migration patterns in inventory-system.",
          "concrete_steps": [
            "Add a schema.sql or Alembic migrations folder showing table creation, indexes, and foreign keys.",
            "Include an example of an optimized JOIN or transaction handling in db_client.py.",
            "Document database connection pooling in README.md."
          ],
          "code_example_hint": "CREATE INDEX idx_inventory_item_status ON items (status, created_at DESC);"
        }
      ]
    },
    {
      "skill": "Kubernetes",
      "current_tier": "NO_EVIDENCE_FOUND",
      "priority": "HIGH",
      "upgrade_actions": [
        {
          "action_summary": "Publish a container deployment proof point for fire-detection-api.",
          "concrete_steps": [
            "Create a k8s/ deployment and service manifest for the existing Dockerfile.",
            "Add a ConfigMap and Secrets setup showing secure environment configuration.",
            "Document local deployment instructions using Minikube or Kind in the README."
          ],
          "code_example_hint": "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: fire-detection-api"
        }
      ]
    }
  ],
  "limitations": [
    "Private repositories not listed in config/profile.yml were excluded from this analysis.",
    "Absence of public evidence does not imply candidate lacks skill, but indicates an external reviewer cannot independently verify it."
  ]
}
```
