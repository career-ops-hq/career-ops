"""Build the retained deterministic JD/CV preparation plan before interview generation."""

from __future__ import annotations

from datetime import datetime, timezone
import re

from workflow.interview_store import digest
from workflow.jd_skill_gap import classify_skill_gaps, diagnose_extraction, scan_jd
from workflow.skill_extract import canonicalize, extract_skills


SCHEMA = "career-ops/preparation-plan"
CLASSIFICATIONS = frozenset({"evidenced", "evidence_gap", "adjacent", "actual_gap", "unverified"})
PRE_ACTIONS = {
    "evidence_gap": "Verify the existing evidence; strengthen only from an approved source.",
    "adjacent": "State the adjacent evidence and the boundary; do not claim direct experience.",
    "actual_gap": "Do not claim this capability; decide whether focused learning is worth the application.",
    "unverified": "Resolve from the JD, an approved source, or a recruiter question before relying on it.",
}
INTERVIEW_ACTIONS = {
    "evidence_gap": "Prepare one source-backed example and its limits.",
    "adjacent": "Prepare a bridge answer from the adjacent experience to the requirement.",
    "actual_gap": "Prepare an honest gap-and-learning answer.",
    "unverified": "Prepare a clarifying question and avoid assumptions.",
}


def report_classifications(report_text: str) -> list[dict]:
    mappings = []
    for line in report_text.split("\n"):
        if not re.match(r"^\s*\|", line):
            continue
        cells = [cell.strip() for cell in line.split("|")[1:-1]]
        index = next((i for i, cell in enumerate(cells) if cell.lower() in {"proven", "adjacent", "gap", "unverified"}), None)
        if index is None:
            continue
        requirement = next((cell for cell in reversed(cells[:index]) if cell and not re.fullmatch(r"#?\d+", cell)), None)
        if not requirement or re.fullmatch(r"[-: ]+", requirement):
            continue
        mappings.append({
            "requirement": requirement,
            "classification": {"proven": "evidenced", "adjacent": "adjacent", "gap": "actual_gap", "unverified": "unverified"}[cells[index].lower()],
            "evidence": cells[index + 1] if index + 1 < len(cells) and cells[index + 1] else None,
            "source": "report",
        })
    return mappings


def build_preparation_plan(
    *, company: str, role: str, jd_text: str, cv_text: str, profile_text: str = "", report_text: str = "",
    sources: dict | None = None, generated_at: str | None = None,
) -> dict:
    if not company or not role or not jd_text.strip():
        raise ValueError("company, role and non-empty JD are required")
    sources = sources or {}
    jd_skills, _ = scan_jd(jd_text)
    diagnosis = diagnose_extraction(jd_text, jd_skills)
    classified = classify_skill_gaps(jd_skills, cv_text)
    profile_skills = extract_skills(profile_text)
    by_key = {}

    def item(requirement: str, classification: str, evidence: str | None, source: str) -> dict:
        if classification not in CLASSIFICATIONS:
            raise ValueError("Invalid preparation classification")
        return {"requirement": requirement, "classification": classification, "evidence": evidence, "source": source}

    cv_source = sources.get("cv") or "cv.md"
    profile_source = sources.get("profile") or "config/profile.yml"
    for skill in classified["existing"]:
        by_key[canonicalize(skill).lower()] = item(skill, "evidenced", "Named in cv.md Skills", cv_source)
    for skill in classified["supportedByResume"]:
        by_key[canonicalize(skill).lower()] = item(skill, "evidence_gap", "Present in CV prose but not the Skills section", cv_source)
    for skill in classified["gap"]:
        in_profile = canonicalize(skill) in profile_skills
        by_key[canonicalize(skill).lower()] = item(
            skill, "evidence_gap" if in_profile else "actual_gap",
            "Named in profile but not evidenced in cv.md" if in_profile else "No evidence found in approved candidate sources",
            profile_source if in_profile else f"{cv_source}; {profile_source}",
        )
    for mapping in report_classifications(report_text):
        by_key[canonicalize(mapping["requirement"]).lower()] = mapping
    if diagnosis:
        messages = {
            "empty-jd": "The JD file is empty, so nothing was checked.",
            "no-requirements-section": "No requirements section was recognized in this JD, so no text was scanned for skills. This is not the same as no gaps.",
            "no-skill-candidates": "A requirements section was scanned, but no skill candidates were extracted. This is not the same as no gaps.",
        }
        by_key["jd requirements"] = item("JD requirements", "unverified", messages[diagnosis], sources.get("jd") or "JD")

    requirements = sorted(by_key.values(), key=lambda entry: entry["requirement"].casefold())
    def actions(phrases: dict) -> list[dict]:
        return [{"requirement": entry["requirement"], "classification": entry["classification"],
                 "action": phrases[entry["classification"]]}
                for entry in requirements if entry["classification"] != "evidenced"]

    return {
        "schema": SCHEMA, "schema_version": 1,
        "metadata": {
            "generated_at": generated_at or datetime.now(timezone.utc).isoformat(),
            "source_hash": digest({"jdText": jd_text, "cvText": cv_text, "profileText": profile_text, "reportText": report_text}),
            "sources": {"jd": sources.get("jd"), "cv": cv_source, "profile": profile_source, "report": sources.get("report")},
        },
        "role": {"company": company, "title": role},
        "requirements": requirements,
        "pre_application": actions(PRE_ACTIONS),
        "interview_preparation": actions(INTERVIEW_ACTIONS),
    }


def validate_preparation_plan(plan: dict) -> bool:
    return (
        plan.get("schema") == SCHEMA and plan.get("schema_version") == 1
        and bool(plan.get("role", {}).get("company") and plan["role"].get("title"))
        and bool(re.fullmatch(r"[a-f0-9]{64}", plan.get("metadata", {}).get("source_hash", "")))
        and isinstance(plan.get("requirements"), list)
        and all(entry.get("classification") in CLASSIFICATIONS for entry in plan["requirements"])
        and isinstance(plan.get("pre_application"), list)
        and isinstance(plan.get("interview_preparation"), list)
    )
