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
elif phase == "apply_evaluate":
    feedback = payload["inputs"].get("feedback", [])
    if "Emphasize verified testing work" in feedback and "Regenerate for current facts" not in feedback:
        assert payload.get("previous_artifact", {}).get("cover_letter") == "Grounded cover letter"
    if "Regenerate for current facts" in feedback:
        assert payload.get("previous_artifact") is None
    if "force-budget" in feedback:
        assert payload.get("previous_artifact", {}).get("cover_letter") == "Grounded cover letter"
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
elif phase == "evaluate":
    if os.environ.get("WORKFLOW_TEST_DURABLE_FAIL") or os.environ.get("WORKFLOW_TEST_DURABLE_SUCCESS"):
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from career_ops.model import record_call
        record_call()
        if os.environ.get("WORKFLOW_TEST_DURABLE_FAIL"):
            raise SystemExit("injected failure after model dispatch")
        record_call()
    if os.environ.get("WORKFLOW_TEST_SLEEP"):
        time.sleep(float(os.environ["WORKFLOW_TEST_SLEEP"]))
    if os.environ.get("WORKFLOW_TEST_INVALID_JSON"):
        print("not JSON")
        raise SystemExit
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
        "score": {"direction": 4, "compensation": 4, "company": None},
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
else:
    raise SystemExit(f"unknown phase: {phase}")
