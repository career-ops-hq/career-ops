"""Return deterministic communication drafts and review decisions for isolated tests."""

import json
import os
from pathlib import Path
import sqlite3
import sys


phase = sys.argv[1]
payload = json.load(sys.stdin)
if path := os.environ.get("COMMUNICATION_TEST_CALL_LOG"):
    with Path(path).open("a") as stream:
        stream.write(phase + "\n")
if phase == "draft":
    assert "three years of software delivery" in payload["task"]
    assert "do not calculate a decimal duration" in payload["task"]
    assert "Chinese name exactly as written" in payload["task"]
    assert "canonical job role verbatim" in payload["task"]
    job = payload["context"]["job"]
    repair_marker = os.environ.get("COMMUNICATION_TEST_REPAIR_MARKER")
    repair_needed = bool(repair_marker and not Path(repair_marker).exists())
    if repair_needed:
        Path(repair_marker).write_text("first draft rejected")
    quote = ("invented experience" if os.environ.get("COMMUNICATION_TEST_BAD_CLAIM") or repair_needed
             else payload["context"]["job"]["jd"] if os.environ.get("COMMUNICATION_TEST_JOB_AS_CANDIDATE")
             else "Verified candidate facts")
    print(json.dumps({
        "email": {"subject": f"Application for {job['role']}", "body": "Verified candidate facts. My resume can be provided on request."
                  if not os.environ.get("COMMUNICATION_TEST_FALSE_ATTACHMENT") else "简历中附有当前与期望薪资及可入职时间。"},
        "outreach": {"message": "x" * 151 if os.environ.get("COMMUNICATION_TEST_LONG_GREETING") else
                     "My resume is attached." if os.environ.get("COMMUNICATION_TEST_OUTREACH_ATTACHMENT") else
                     f"Hello, I am interested in {job['role']} at {job['company']}."},
        "claims": [{"claim": "Verified candidate facts", "source": "jd" if os.environ.get("COMMUNICATION_TEST_JOB_AS_CANDIDATE") else "cv", "quote": quote}],
    }))
elif phase == "review":
    assert "software-delivery duration" in payload["task"]
    if marker := os.environ.get("COMMUNICATION_TEST_REVIEW_CRASH_ONCE"):
        if not Path(marker).exists():
            Path(marker).write_text("first review failed")
            raise SystemExit(3)
    if os.environ.get("COMMUNICATION_TEST_REQUIRE_COMPLETE_REVIEW_CONTEXT"):
        context = payload["context"]
        assert {"cv", "profile", "targeting", "articles", "writing-samples/sample.md"} <= set(context["candidate_sources"])
        assert context["score"] and context["source_evidence"] and context["artifact_refs"]
    if database := os.environ.get("COMMUNICATION_TEST_MUTATE_DB"):
        with sqlite3.connect(database) as db:
            db.execute("UPDATE source_evidence SET payload=? WHERE opportunity_id=1",
                       (json.dumps({"description": "Evidence changed during drafting"}),))
    revise_marker = os.environ.get("COMMUNICATION_TEST_REVIEW_REVISE_ONCE")
    revise_once = bool(revise_marker and not Path(revise_marker).exists())
    if revise_once:
        Path(revise_marker).write_text("first review requested correction")
    approved = not os.environ.get("COMMUNICATION_TEST_REVIEW_FAIL") and not revise_once
    print(json.dumps({"verdict": "approve" if approved else "revise", "grounded": "pass" if approved else "fail",
                      "policy": "pass", "authorship_scope": "pass", "unlisted_claims": [],
                      "reason": "Facts checked" if approved else "Unsupported fact"}))
else:
    raise SystemExit(f"Unknown phase: {phase}")
