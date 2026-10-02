"""Build a source-grounded preparation plan for one role."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import re

from career_ops.skills import canonicalize, extract_skills
from career_ops.insights.upskill import targeted_skill_gap


SCHEMA = "career-ops/preparation-plan"
CLASSIFICATIONS = {"evidenced", "evidence_gap", "adjacent", "actual_gap", "unverified"}
PRE_ACTION = {
    "evidence_gap": "Verify the existing evidence; strengthen only from an approved source.",
    "adjacent": "State the adjacent evidence and the boundary; do not claim direct experience.",
    "actual_gap": "Do not claim this capability; decide whether focused learning is worth the application.",
    "unverified": "Resolve from the JD, an approved source, or a recruiter question before relying on it.",
}
INTERVIEW_ACTION = {
    "evidence_gap": "Prepare one source-backed example and its limits.",
    "adjacent": "Prepare a bridge answer from the adjacent experience to the requirement.",
    "actual_gap": "Prepare an honest gap-and-learning answer.",
    "unverified": "Prepare a clarifying question and avoid assumptions.",
}


def parse_report_classifications(report: str) -> list[dict]:
    """Use the report's reviewed capability verdicts as the final evidence source."""
    mappings = []
    verdicts = {"proven": "evidenced", "adjacent": "adjacent", "gap": "actual_gap", "unverified": "unverified"}
    for line in report.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.split("|")[1:-1]]
        index = next((i for i, cell in enumerate(cells) if cell.lower() in verdicts), None)
        if index is None:
            continue
        requirement = next((cell for cell in reversed(cells[:index]) if cell and not re.fullmatch(r"#?\d+", cell)), "")
        if not requirement or re.fullmatch(r"[-: ]+", requirement):
            continue
        mappings.append({"requirement": requirement, "classification": verdicts[cells[index].lower()],
                         "evidence": cells[index + 1] if index + 1 < len(cells) and cells[index + 1] else None,
                         "source": "report"})
    return mappings


def build_preparation_plan(company: str, role: str, jd: str, cv: str, profile: str = "", report: str = "",
                           *, sources: dict | None = None, generated_at: str | None = None) -> dict:
    """Classify JD requirements and produce two honest, actionable checklists."""
    if not company or not role or not jd.strip():
        raise ValueError("company, role, and non-empty JD are required")
    sources = sources or {}
    classified = targeted_skill_gap(jd, cv)
    profile_skills = extract_skills(profile)
    by_key = {}

    def put(requirement: str, classification: str, evidence: str, source: str) -> None:
        by_key[canonicalize(requirement).lower()] = {"requirement": requirement, "classification": classification,
                                                      "evidence": evidence, "source": source}

    for skill in classified["existing"]:
        put(skill, "evidenced", "Named in cv.md Skills", sources.get("cv") or "cv.md")
    for skill in classified["supportedByResume"]:
        put(skill, "evidence_gap", "Present in CV prose but not the Skills section", sources.get("cv") or "cv.md")
    for skill in classified["gap"]:
        known = canonicalize(skill) in profile_skills
        put(skill, "evidence_gap" if known else "actual_gap",
            "Named in profile but not evidenced in cv.md" if known else "No evidence found in approved candidate sources",
            (sources.get("profile") or "config/profile.yml") if known else
            f"{sources.get('cv') or 'cv.md'}; {sources.get('profile') or 'config/profile.yml'}")
    for mapping in parse_report_classifications(report):
        by_key[canonicalize(mapping["requirement"]).lower()] = mapping
    if classified["status"] == "inconclusive":
        put("JD requirements", "unverified", classified["lowConfidence"]["message"], sources.get("jd") or "JD")
    requirements = sorted(by_key.values(), key=lambda row: row["requirement"].lower())
    raw = {"jdText": jd, "cvText": cv, "profileText": profile, "reportText": report}
    source_hash = hashlib.sha256(json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()

    def actions(messages: dict) -> list[dict]:
        return [{"requirement": row["requirement"], "classification": row["classification"],
                 "action": messages[row["classification"]]} for row in requirements if row["classification"] != "evidenced"]

    return {"schema": SCHEMA, "schema_version": 1,
            "metadata": {"generated_at": generated_at or datetime.now(timezone.utc).isoformat(),
                         "source_hash": source_hash,
                         "sources": {"jd": sources.get("jd"), "cv": sources.get("cv") or "cv.md",
                                     "profile": sources.get("profile") or "config/profile.yml", "report": sources.get("report")}},
            "role": {"company": company, "title": role}, "requirements": requirements,
            "pre_application": actions(PRE_ACTION), "interview_preparation": actions(INTERVIEW_ACTION)}


def validate_preparation_plan(plan: dict) -> dict:
    """Check the persisted plan contract before another tool consumes it."""
    errors = []
    if plan.get("schema") != SCHEMA or plan.get("schema_version") != 1:
        errors.append("schema mismatch")
    if not plan.get("role", {}).get("company") or not plan.get("role", {}).get("title"):
        errors.append("role is required")
    if not re.fullmatch(r"[a-f0-9]{64}", plan.get("metadata", {}).get("source_hash", "")):
        errors.append("metadata.source_hash is required")
    rows = plan.get("requirements")
    if not isinstance(rows, list) or any(not isinstance(row, dict) or row.get("classification") not in CLASSIFICATIONS for row in rows):
        errors.append("invalid requirements")
    if not isinstance(plan.get("pre_application"), list) or not isinstance(plan.get("interview_preparation"), list):
        errors.append("preparation sections are required")
    return {"valid": not errors, "errors": errors}
