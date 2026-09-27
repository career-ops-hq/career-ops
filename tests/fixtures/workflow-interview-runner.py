"""Deterministic unit runner for interview graph nodes; never calls an external model."""

import json
import os
import sys


payload = json.load(sys.stdin)
kind = payload["kind"]
if payload["phase"] == "revise":
    assert payload["previous_artifact"] and payload["previous_review"]["verdict"] == "revise"
    if os.environ.get("INTERVIEW_TEST_FAIL_REVISION"):
        raise SystemExit("transient draft failure")
    if kind == "prepare":
        first = payload["previous_artifact"]["sections"]["requirements"][0]
        print(json.dumps({"requirements": [{**first, "response": first["response"] + " (ownership clarified)"}]}))
    else:
        name, value = next(iter(payload["previous_artifact"]["sections"].items()))
        print(json.dumps({"sections": {name: value + " (ownership clarified)"}}))
elif payload["phase"] == "draft":
    if os.environ.get("INTERVIEW_TEST_FAIL_DRAFT"):
        raise SystemExit("Unexpected draft generation during review-only recovery")
    if os.environ.get("INTERVIEW_TEST_BAD_QUOTE") and payload["revision"]:
        assert payload["previous_artifact"] is None
    if os.environ.get("INTERVIEW_TEST_REVISE_ONCE") and payload["revision"]:
        assert payload["previous_artifact"]
    if os.environ.get("INTERVIEW_TEST_FAIL_REVISION") and payload["revision"] == 1:
        raise SystemExit("transient draft failure")
    sections = {
        "practice": {"questions": "Explain Python work", "answer_feedback": "Use verified examples", "learning": "Review async services"},
        "debrief": {"observations": "Interview notes", "recruiting_risks": "Clarify role scope", "learning": "Study async services"},
        "learn": {"themes": "Evidence clarity", "actions": "Practice scoped answers", "sources": "Confirmed interview history"},
    }.get(kind)
    if kind == "prepare":
        sections = {"requirements": [
            {"requirement": item["requirement"], "classification": item["classification"], "response": "Check the cited source"}
            for item in payload["input"]["preparation_plan"]["requirements"]
        ], "story_matches": "Source-backed story", "timeline": "Day 1: review JD", "risk_questions": "Clarify employment"}
    if payload["revision"]:
        section = "timeline" if kind == "prepare" else next(iter(sections))
        sections[section] += f" (ownership clarified {payload['revision']})"
    if os.environ.get("INTERVIEW_TEST_EMPTY_SECTION"):
        sections["answer_feedback"] = ""
    quote = ("not in CV" if os.environ.get("INTERVIEW_TEST_BAD_QUOTE") else
             "Languages and frameworks: Python" if os.environ.get("INTERVIEW_TEST_MARKDOWN_QUOTE") else
             "Experience in Python")
    print(json.dumps({
        "schema": "career-ops/interview-artifact", "schema_version": 1,
        "kind": kind, "sections": sections,
        "claims": [{"subject": "Python work" if os.environ.get("INTERVIEW_TEST_BAD_SUBJECT") else "candidate",
                    "text": "Python experience", "source": "cv.md", "quote": quote}],
    }))
else:
    if os.environ.get("INTERVIEW_TEST_MALFORMED_REVIEW_ONCE") and not payload.get("previous_review"):
        print(json.dumps({"verdict": "approve", "checks": {"source_grounding": "pass"}}))
        raise SystemExit(0)
    checks = {name: {"status": "pass", "finding": "Verified from frozen sources"} for name in (
        "source_grounding", "ownership", "session_scope", "recruiting_risk", "completeness"
    )}
    if os.environ.get("INTERVIEW_TEST_REVISE_ONCE") and payload["revision"] == 0:
        checks["ownership"] = {"status": "fail", "finding": "Clarify responsibility"}
        print(json.dumps({"verdict": "revise", "checks": checks, "unsupported_claims": [], "required_changes": ["Clarify ownership"]}))
    else:
        print(json.dumps({"verdict": "approve", "checks": checks, "unsupported_claims": [], "required_changes": []}))
