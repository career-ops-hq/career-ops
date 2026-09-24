"""Deterministic process boundary used by the public workflow CLI test."""

import json
import hashlib
import os
from pathlib import Path
import sys
import time


phase = sys.argv[1]
payload = json.load(sys.stdin)
if path := os.environ.get("WORKFLOW_TEST_CALL_LOG"):
    with Path(path).open("a") as stream:
        stream.write(phase + "\n")
if phase == "scan_evaluate":
    source = payload["inputs"]["source"]
    if source.get("test_exclude"):
        print(json.dumps({
            "outcome": "exclude",
            "artifact": {"type": "exclusion", "reason": "Confirmed employment mismatch", "evidence": ["contractor"]},
            "tool_calls": 1,
        }))
        raise SystemExit
    print(json.dumps({
        "outcome": "jd_report",
        "artifact": {
            "schema_version": "jd_report_v1",
            "opportunity_id": source["opportunity_id"],
            "url": source["url"],
            "company": source["company"],
            "role": source["role"],
            "jd": source["jd"],
            "captured_at": source["captured_at"],
            "liveness": source["liveness"],
            "prescreen": {"status": "pass", "unknowns": ["compensation"]},
        },
        "tool_calls": 1,
    }))
elif phase == "scan_review":
    print(json.dumps({"verdict": "approve", "checks": {"grounded": "pass"}, "tool_calls": 1}))
elif phase == "apply_evaluate":
    feedback = payload["inputs"].get("feedback", [])
    print(json.dumps({
        "outcome": "package",
        "artifact": {
            "resume_payload": {"candidate": {"name": "Jiaming Zhang"}, "summary": "Verified AI engineer", "experience": [], "projects": [], "education": [], "certifications": [], "awards": [], "skills": []},
            "changes": "# Evidence-backed changes",
            "cover_letter": "Grounded cover letter",
            "upskill": "# Upskill plan",
            "interview_prep": "# Interview preparation",
            "questions": "# Questions",
        },
        "tool_calls": 20 if "force-budget" in feedback else 1,
    }))
elif phase == "apply_review":
    checks = ["source-grounding", "role-alignment", "cv-materiality", "employer-questions", "sensitive-fields", "artifact-consistency"]
    forced = "force-review-failure" in payload["inputs"].get("feedback", [])
    print(json.dumps({
        "verdict": "revise" if forced else "approve", "schema": "career-ops/application-review", "schema_version": 1,
        "checks": [{"id": item, "status": "fail" if forced and item == "source-grounding" else "pass", "finding": "Verified"} for item in checks],
        "unsupported_claims": ["Unsupported"] if forced else [],
        "required_changes": ["Remove claim"] if forced else [], "tool_calls": 1,
    }))
elif phase == "evaluate":
    if os.environ.get("WORKFLOW_TEST_SLEEP"):
        time.sleep(float(os.environ["WORKFLOW_TEST_SLEEP"]))
    if os.environ.get("WORKFLOW_TEST_RUNNER_FAIL") == "1":
        raise SystemExit("injected model failure")
    report = payload["inputs"]["jd_report"]
    if report["prescreen"]["status"] == "fail":
        print(json.dumps({
            "outcome": "exclude",
            "artifact": {"type": "exclusion", "reason": report["prescreen"]["reason"], "evidence": report["prescreen"].get("evidence", [report["url"]])},
            "tool_calls": 0,
        }))
        raise SystemExit
    artifact = {
        "type": "score",
        "company": report["company"],
        "role": report["role"],
        "score": {"lower": 3.5, "upper": 4.5, "coverage": 0.75},
        "report": "# Verified score report",
        "report_sha256": hashlib.sha256(b"# Verified score report").hexdigest(),
    }
    if os.environ.get("WORKFLOW_TEST_DRAFT_DIRECTORY"):
        artifact["draft_directory"] = os.environ["WORKFLOW_TEST_DRAFT_DIRECTORY"]
    print(json.dumps({
        "outcome": "score",
        "artifact": artifact,
        "tool_calls": 3,
    }))
elif phase == "review":
    if payload["artifact"]["type"] == "score":
        assert payload["artifact"]["report"] == "# Verified score report"
    names = ("jd_complete", "source_grounding", "dimension_support", "capability_coverage", "no_double_count", "gate_evidence")
    failed = os.environ.get("WORKFLOW_TEST_FAILED_CHECK") == "1"
    decision = {
        "verdict": "approve",
        "checks": {name: {"status": "fail" if failed and name == "source_grounding" else "pass", "finding": "Verified"} for name in names},
        "gates": {name: "Pass" if name == "liveness" else "Unknown" for name in ("location", "employment", "size", "compensation", "eligibility", "liveness")},
        "ready": False,
        "report_sha256": payload["artifact"].get("report_sha256"),
        "tool_calls": 1,
    }
    if os.environ.get("WORKFLOW_TEST_DRAFT_DIRECTORY"):
        path = Path(os.environ["WORKFLOW_TEST_DRAFT_DIRECTORY"]) / "report.md.review.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(decision))
    print(json.dumps(decision))
else:
    raise SystemExit(f"unknown phase: {phase}")
