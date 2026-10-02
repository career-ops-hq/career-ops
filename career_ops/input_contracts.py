"""Bind candidate inputs and validate frozen application package evidence."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from career_ops.context import INPUT_ROOT, SCAN_POLICY_VERSION, SCORE_POLICY_VERSION


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def score_inputs(report: dict) -> str:
    """Bind a JD report to every module-level policy and candidate input."""
    required = {"schema_version", "opportunity_id", "url", "company", "role", "jd", "captured_at", "liveness", "prescreen"}
    missing = sorted(required - report.keys())
    if missing:
        raise ValueError("JD report missing: " + ", ".join(missing))
    if report["schema_version"] != "jd_report_v1":
        raise ValueError("Unsupported JD report schema")
    if report["liveness"] != "active" or not str(report["jd"]).strip():
        raise ValueError("A complete active JD report is required")
    if not all(str(report[key]).strip() for key in ("opportunity_id", "url", "company", "role", "captured_at")):
        raise ValueError("JD report identity and capture fields cannot be empty")
    if not isinstance(report["prescreen"], dict) or report["prescreen"].get("status") not in {"pass", "fail", "incomplete", "uncertain"}:
        raise ValueError("JD report prescreen status is invalid")
    inputs = {
        "score_policy_version": SCORE_POLICY_VERSION,
        "jd_report": report,
        "cv": (INPUT_ROOT / "cv.md").read_text(),
        "profile": (INPUT_ROOT / "config" / "profile.yml").read_text(),
        "targeting": (INPUT_ROOT / "modes" / "_profile.md").read_text(),
        "rules": (INPUT_ROOT / "modes" / "_custom.md").read_text(),
        "articles": (INPUT_ROOT / "article-digest.md").read_text() if (INPUT_ROOT / "article-digest.md").is_file() else None,
        "voice": (INPUT_ROOT / "voice-dna.md").read_text() if (INPUT_ROOT / "voice-dna.md").is_file() else None,
        "writing_samples": {
            str(path.relative_to(INPUT_ROOT)): path.read_text()
            for path in sorted((INPUT_ROOT / "writing-samples").glob("**/*")) if path.is_file()
        } if (INPUT_ROOT / "writing-samples").is_dir() else {},
    }
    return json.dumps(inputs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_score_input(value: str) -> str:
    try:
        report = json.loads(value) if value.lstrip().startswith("{") else json.loads(Path(value).read_text())
    except (json.JSONDecodeError, OSError) as error:
        raise ValueError("score requires a jd_report_v1 JSON file or object") from error
    if not isinstance(report, dict) or "jd_report" in report:
        raise ValueError("score input must be one jd_report_v1 object, not a workflow envelope")
    return score_inputs(report)


def canonical_scan_input(value: str) -> str:
    try:
        source = json.loads(value) if value.lstrip().startswith("{") else json.loads(Path(value).read_text())
    except (json.JSONDecodeError, OSError) as error:
        raise ValueError("scan requires a scan_input_v1 JSON file or object") from error
    if not isinstance(source, dict) or "source" in source:
        raise ValueError("scan input must be one scan_input_v1 object, not a workflow envelope")
    required = {"schema_version", "opportunity_id", "url", "company", "role", "jd", "captured_at", "liveness"}
    missing = sorted(required - source.keys())
    if missing:
        raise ValueError("Scan input missing: " + ", ".join(missing))
    if source["schema_version"] != "scan_input_v1":
        raise ValueError("Unsupported scan input schema")
    if any(not isinstance(source[key], str) or not source[key].strip() for key in ("opportunity_id", "url", "company", "role", "captured_at")):
        raise ValueError("Scan input identity and capture fields must be nonempty strings")
    if not isinstance(source["jd"], str) or source["liveness"] not in {"active", "uncertain"}:
        raise ValueError("Scan input JD or liveness is invalid")
    inputs = {
        "scan_policy_version": SCAN_POLICY_VERSION,
        "source": source,
        "cv": (INPUT_ROOT / "cv.md").read_text(),
        "profile": (INPUT_ROOT / "config" / "profile.yml").read_text(),
        "targeting": (INPUT_ROOT / "modes" / "_profile.md").read_text(),
        "rules": (INPUT_ROOT / "modes" / "_custom.md").read_text(),
    }
    return json.dumps(inputs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def apply_inputs(jd_report: dict, score_result: dict, feedback: list[str]) -> str:
    score_inputs(jd_report)
    inputs = {
        "artifact_contract_version": 4,
        "jd_report": jd_report,
        "score_result": score_result,
        "cv": (INPUT_ROOT / "cv.md").read_text(),
        "profile": (INPUT_ROOT / "config" / "profile.yml").read_text(),
        "targeting": (INPUT_ROOT / "modes" / "_profile.md").read_text(),
        "rules": (INPUT_ROOT / "modes" / "_custom.md").read_text(),
        "contract": (INPUT_ROOT / "prompts" / "shared" / "contract.md").read_text(),
        "requirements": (INPUT_ROOT / "prompts" / "applications" / "workflow.md").read_text(),
        "articles": (INPUT_ROOT / "article-digest.md").read_text() if (INPUT_ROOT / "article-digest.md").is_file() else None,
        "voice": (INPUT_ROOT / "voice-dna.md").read_text() if (INPUT_ROOT / "voice-dna.md").is_file() else None,
        "writing_samples": {
            str(path.relative_to(INPUT_ROOT)): path.read_text()
            for path in sorted((INPUT_ROOT / "writing-samples").glob("**/*")) if path.is_file()
        } if (INPUT_ROOT / "writing-samples").is_dir() else {},
        "market_rules": {
            market: (INPUT_ROOT / "markets" / market / "employment.md").read_text()
            for market in ("cn", "hk", "remote")
        },
        "feedback": feedback,
    }
    return json.dumps(inputs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def validate_resume_payload(payload: dict) -> None:
    if not payload.get("candidate", {}).get("name") or not isinstance(payload.get("summary"), str):
        raise ValueError("resume_payload requires candidate.name and summary")
    if "projects_start_on_new_page" in payload and not isinstance(payload["projects_start_on_new_page"], bool):
        raise ValueError("resume_payload projects_start_on_new_page must be boolean")
    for entry in payload.get("experience", []):
        if not all(key in entry for key in ("company", "role", "dates", "bullets")) or not isinstance(entry["bullets"], list):
            raise ValueError("resume experience requires company, role, dates and bullets")
    for entry in payload.get("education", []):
        if not all(key in entry for key in ("org", "title", "year")):
            raise ValueError("resume education requires org, title and year")
    for entry in payload.get("projects", []):
        if "name" not in entry or not isinstance(entry.get("bullets", []), list):
            raise ValueError("resume projects require name and bullets")
    for entry in payload.get("skills", []):
        if "category" not in entry or "items" not in entry:
            raise ValueError("resume skills require category and items")


def verify_package_files(draft: dict, *, require_pdf: bool) -> None:
    files = draft.get("files", {})
    required = {"resume_payload", "changes", "cover_letter", "upskill", "interview_prep", "questions"}
    if require_pdf:
        required |= {"resume_pdf", "resume_metadata"}
    if not isinstance(files, dict) or set(files) != required:
        raise ValueError("Current package file manifest is incomplete")
    if require_pdf and (not isinstance(draft.get("pdf_receipt"), dict)
                        or not isinstance(draft["pdf_receipt"].get("pages"), int)
                        or draft["pdf_receipt"]["pages"] < 1):
        raise ValueError("Current package has no validated resume PDF")
    if not isinstance(draft.get("file_hashes"), dict) or set(draft["file_hashes"]) != required:
        raise ValueError("Current package file manifest is incomplete")
    artifact = {name: draft.get(name) for name in ("files", "file_hashes", "package", "pdf_receipt")}
    if digest(json.dumps(artifact, ensure_ascii=False, sort_keys=True)) != draft.get("package_hash"):
        raise ValueError("Current package manifest changed")
    for name, path in files.items():
        try:
            current_hash = hashlib.sha256(Path(path).read_bytes()).hexdigest()
        except OSError as error:
            raise ValueError(f"Current package file is unavailable: {name}") from error
        if current_hash != draft["file_hashes"][name]:
            raise ValueError(f"Current package file changed: {name}")
