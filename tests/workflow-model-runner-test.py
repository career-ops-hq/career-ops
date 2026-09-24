"""Verify resume reuses a rendered score instead of repeating web research."""

import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow import model_adapter

spec = importlib.util.spec_from_file_location("workflow_model_runner", ROOT / "workflow" / "model_runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

flattened = {"name": "Jiaming Zhang", "email": "candidate@example.com", "summary": "Grounded"}
normalized = runner.normalize_resume_payload(flattened)
assert normalized["candidate"] == {"name": "Jiaming Zhang", "email": "candidate@example.com"}
assert "name" not in normalized

complete_package = {
    "resume_payload": {
        "candidate": {"name": "Jiaming Zhang"}, "summary": "Grounded",
        "experience": [], "projects": [], "education": [], "skills": [],
    },
    "changes": "Grounded changes", "cover_letter": "Grounded letter",
    "upskill": "Grounded plan", "interview_prep": "Grounded preparation",
    "questions": "Grounded questions",
}
package_phases = []
original_call_agent = model_adapter.call_agent
def package_call(phase, *_args):
    package_phases.append(phase)
    return ({"resume_payload": complete_package["resume_payload"], "changes": "partial"}
            if phase == "apply_evaluate" else complete_package), f"{phase}-session"
model_adapter.call_agent = package_call
try:
    package = runner.apply_evaluate({"inputs": {}, "revision": 0})
finally:
    model_adapter.call_agent = original_call_agent
assert package_phases == ["apply_evaluate", "apply_repair"]
assert package["artifact"] == complete_package
assert package["tool_calls"] == 2

review_checks = [
    {"id": item, "status": "pass", "finding": "Grounded"}
    for item in (
        "source-grounding", "role-alignment", "cv-materiality",
        "employer-questions", "sensitive-fields", "artifact-consistency",
    )
]
complete_review = {
    "schema": "career-ops/application-review", "schema_version": 1,
    "verdict": "approve", "checks": review_checks,
    "unsupported_claims": [], "required_changes": [],
}
review_phases = []
def review_call(phase, *_args):
    review_phases.append(phase)
    return ({**complete_review, "unsupported_claims": None}
            if phase == "apply_review" else complete_review), f"{phase}-session"
model_adapter.call_agent = review_call
try:
    reviewed = runner.apply_review({"inputs": {}, "artifact": complete_package})
finally:
    model_adapter.call_agent = original_call_agent
assert review_phases == ["apply_review", "apply_review_repair"]
assert reviewed["verdict"] == "approve"
assert reviewed["tool_calls"] == 2

inputs = {
    "jd_report": {"prescreen": {"status": "uncertain"}},
    "cv": "cv", "profile": "attractiveness:\n  weights:\n    direction: 0.25\n    compensation: 0.25\n    team: 0.25\n    company: 0.25\n",
    "targeting": "targeting", "rules": "rules",
}

with tempfile.TemporaryDirectory(prefix="career-ops-runner-") as temporary:
    runner.DRAFT_ROOT = Path(temporary)
    key = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    directory = runner.DRAFT_ROOT / key
    directory.mkdir()
    (directory / "report.md").write_text("# Completed draft")
    (directory / "assessment.json").write_text(json.dumps({
        "dimensions": {
            "direction": {"score": 4, "evidence": ["grounded"]},
            "compensation": {"score": None, "evidence": []},
            "team": {"score": 3, "evidence": ["grounded"]},
            "company": {"score": 5, "evidence": ["grounded"]},
        }
    }))
    (directory / "evidence.json").write_text(json.dumps({"liveness_reason": "Verified active"}))
    result = runner.evaluate({"inputs": inputs, "revision": 0})
    assert result["artifact"]["report"] == "# Completed draft"
    assert result["artifact"]["score"] == {"lower": 3.25, "upper": 4.25, "coverage": 0.75}
    assert result["tool_calls"] == 0

    responses = iter((
        {"direction": {}, "compensation": {}, "team": {}, "company": {}},
        {"direction": {}, "compensation": {}, "team": {}, "company": {}, "sections": {}},
    ))

    class Agent:
        request_overrides = None
        _api_max_retries = 0

        def run_conversation(self, prompt):
            return {"completed": True, "final_response": json.dumps(next(responses)), "messages": []}

        def close(self):
            pass

    calls = []
    original_create_agent = model_adapter.create_agent
    model_adapter.create_agent = lambda **kwargs: calls.append(kwargs) or Agent()
    try:
        repaired, _ = model_adapter.call_agent("repair", "prompt", [], Path(temporary))
    finally:
        model_adapter.create_agent = original_create_agent
    assert repaired["sections"] == {}
    assert len(calls) == 2

with tempfile.TemporaryDirectory(prefix="career-ops-render-repair-", dir=ROOT / "data") as temporary:
    runner.DRAFT_ROOT = Path(temporary)
    jd = "Build developer tools and reviewed AI workflows."
    repair_inputs = {
        "jd_report": {
            "opportunity_id": "real-job", "url": "https://example.com/real-job",
            "company": "Example", "role": "Engineer", "jd": jd,
            "captured_at": "2026-09-24T00:00:00Z", "liveness_reason": "Official page active",
            "prescreen": {"status": "uncertain", "unknowns": ["compensation"]},
        },
        "cv": "Verified candidate facts.",
        "profile": "attractiveness:\n  weights:\n    direction: 0.25\n    compensation: 0.25\n    team: 0.25\n    company: 0.25\n",
        "targeting": "Verified targeting.", "rules": "Current rules.",
    }
    sections = {name: "Grounded analysis with explicit unknowns and next actions." for name in (
        "overview", "capabilities", "compensation", "questions", "legitimacy", "risks", "checklist"
    )}
    valid_dimensions = {
        "direction": {"score": 4, "rationale": "Direct evidence.", "evidence": [{"source": "jd", "quote": jd}]},
        "compensation": {"score": None, "rationale": "Unknown.", "evidence": []},
        "team": {"score": None, "rationale": "Unknown.", "evidence": []},
        "company": {"score": None, "rationale": "Unknown.", "evidence": []},
    }
    invalid_dimensions = json.loads(json.dumps(valid_dimensions))
    invalid_dimensions["compensation"] = {
        "score": 3, "rationale": "Unsupported.",
        "evidence": [{"source": "research:compensation", "quote": "Invented source"}],
    }
    research = {
        "sources": [],
        "research": {
            "searched_at": "2026-09-24", "queries": ["compensation", "team", "company"],
            "dimensions": {name: {"queries": [index], "conclusion": "Unknown.", "next_step": "Confirm."}
                           for index, name in enumerate(("compensation", "team", "company"))},
            "findings": [],
        },
    }
    phases = []
    original_call_agent = model_adapter.call_agent
    def call_agent(phase, *_args):
        phases.append(phase)
        if phase == "research":
            return research, "research-session"
        dimensions = invalid_dimensions if phase == "assessment" else valid_dimensions
        return {"dimensions": dimensions, "sections": sections}, f"{phase}-session"
    model_adapter.call_agent = call_agent
    try:
        rendered = runner.evaluate({"inputs": repair_inputs, "revision": 0})
    finally:
        model_adapter.call_agent = original_call_agent
    assert phases == ["research", "assessment", "repair"]
    assert rendered["revision"] == 1
    assert rendered["artifact"]["type"] == "score"
    report_path = Path(rendered["artifact"]["draft_directory"]) / "report.md"
    report_path.unlink()
    cached = json.loads((report_path.parent / "assessment.json").read_text())
    cached["dimensions"] = invalid_dimensions
    (report_path.parent / "assessment.json").write_text(json.dumps(cached))
    phases.clear()
    model_adapter.call_agent = call_agent
    try:
        recovered = runner.evaluate({"inputs": repair_inputs, "revision": 0})
    finally:
        model_adapter.call_agent = original_call_agent
    assert phases == ["repair"]
    assert recovered["revision"] == 1

print("workflow model runner: rendered draft recovery avoids repeated research")
