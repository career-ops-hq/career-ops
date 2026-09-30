"""Verify resume reuses a rendered score instead of repeating web research."""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow import model_adapter
from workflow import apply_graph
from workflow import score_graph
from workflow.score_graph import _normalize_assessment

spec = importlib.util.spec_from_file_location("workflow_model_runner", ROOT / "workflow" / "model_runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

flattened = {"name": "Jiaming Zhang", "email": "candidate@example.com", "summary": "Grounded"}
normalized = apply_graph.normalize_resume_payload(flattened)
assert normalized["candidate"] == {"name": "Jiaming Zhang", "email": "candidate@example.com"}
assert "name" not in normalized

nested = {
    "basics": {"name": "Jiaming Zhang", "email": "candidate@example.com"},
    "sections": {
        "summary": {"headline": "Engineer", "summary": "Grounded"},
        "experience": [], "projects": [], "education": [], "skills": [],
        "projects_start_on_new_page": True,
    },
}
assert apply_graph.application_package_error({"resume_payload": nested, **{
    key: "Grounded" for key in ("changes", "cover_letter", "upskill", "interview_prep", "questions")
}}) is None
assert nested == {
    "candidate": {"name": "Jiaming Zhang", "email": "candidate@example.com"},
    "headline": "Engineer", "summary": "Grounded", "experience": [], "projects": [],
    "education": [], "skills": [], "projects_start_on_new_page": True,
}

grouped = {
    "basics": {"name": "Jiaming Zhang", "email": "candidate@example.com", "headline": "Engineer",
               "summary": "Grounded", "profiles": [{"network": "LinkedIn", "url": "https://linkedin.com/in/example"}]},
    "experience": [], "projects": [], "education": [], "skills": [],
}
assert apply_graph.normalize_resume_payload(grouped) == {
    "candidate": {"name": "Jiaming Zhang", "email": "candidate@example.com",
                  "linkedin": {"url": "https://linkedin.com/in/example", "display": "https://linkedin.com/in/example"}},
    "headline": "Engineer", "summary": "Grounded",
    "experience": [], "projects": [], "education": [], "skills": [],
}

complete_package = {
    "resume_payload": {
        "candidate": {"name": "Jiaming Zhang"}, "summary": "Grounded",
        "experience": [], "projects": [], "education": [], "skills": [],
    },
    "changes": "Grounded changes", "cover_letter": "Grounded letter",
    "upskill": "Grounded plan", "interview_prep": "Grounded preparation",
    "questions": "Grounded questions",
}
assert apply_graph.application_package_error({**complete_package, "upskill": {"topics": []}}) == "upskill must be a nonempty Markdown string"
package_phases = []
package_prompts = []
initial_drafts = tempfile.TemporaryDirectory(prefix="career-ops-model-initial-")
runner.DRAFT_ROOT = Path(initial_drafts.name)
original_call_agent = model_adapter.call_agent
def package_call(phase, *_args):
    package_phases.append(phase)
    package_prompts.append(_args[0])
    return ({"resume_payload": complete_package["resume_payload"], "changes": "partial"}
            if phase == "apply_evaluate" else complete_package), f"{phase}-session"
model_adapter.call_agent = package_call
try:
    package = runner.apply_evaluate({"inputs": {}, "revision": 0})
finally:
    model_adapter.call_agent = original_call_agent
assert package_phases == ["apply_evaluate", "apply_repair"]
assert "configured language.output" in package_prompts[0] and "JD language" not in package_prompts[0]
assert package["artifact"] == complete_package
assert package["tool_calls"] == 2

revision_phases = []
def revision_call(phase, *_args):
    revision_phases.append(phase)
    return {"questions": "# Corrected grounded questions"}, "revision-session"
model_adapter.call_agent = revision_call
try:
    revised = runner.apply_evaluate({"inputs": {}, "previous_artifact": complete_package})
finally:
    model_adapter.call_agent = original_call_agent
assert revision_phases == ["apply_evaluate"]
assert revised["artifact"] == {**complete_package, "questions": "# Corrected grounded questions"}
assert complete_package["questions"] == "Grounded questions"
initial_drafts.cleanup()

with tempfile.TemporaryDirectory(prefix="career-ops-apply-checkpoint-") as temporary:
    runner.DRAFT_ROOT = Path(temporary)
    payload = {"inputs": {"feedback": ["checkpoint test"]}}
    validation = apply_graph.application_package_error
    def interrupted_validation(_decision):
        raise RuntimeError("validation interrupted")
    model_adapter.call_agent = lambda *_args, **_kwargs: (complete_package, "draft-session")
    apply_graph.application_package_error = interrupted_validation
    try:
        try:
            runner.apply_evaluate(payload)
        except RuntimeError as error:
            assert str(error) == "validation interrupted"
        else:
            raise AssertionError("Apply validation interruption was not surfaced")
    finally:
        model_adapter.call_agent = original_call_agent
        apply_graph.application_package_error = validation
    assert len(list(runner.DRAFT_ROOT.glob("*/apply-checkpoints.db"))) == 1
    def no_more_apply_calls(*_args, **_kwargs):
        raise AssertionError("Recovery repeated application generation")
    model_adapter.call_agent = no_more_apply_calls
    try:
        assert runner.apply_evaluate(payload)["artifact"] == complete_package
    finally:
        model_adapter.call_agent = original_call_agent

with tempfile.TemporaryDirectory(prefix="career-ops-apply-repair-checkpoint-") as temporary:
    runner.DRAFT_ROOT = Path(temporary)
    payload = {"inputs": {"feedback": ["repair checkpoint test"]}}
    validation = apply_graph.application_package_error
    validations = 0
    def interrupted_finish(decision):
        global validations
        validations += 1
        if validations == 2:
            raise RuntimeError("finish interrupted after repair")
        return validation(decision)
    def repair_call(phase, *_args, **_kwargs):
        if phase == "apply_evaluate":
            return {"resume_payload": complete_package["resume_payload"]}, "draft-session"
        assert phase == "apply_repair"
        return complete_package, "repair-session"
    model_adapter.call_agent = repair_call
    apply_graph.application_package_error = interrupted_finish
    try:
        try:
            runner.apply_evaluate(payload)
        except RuntimeError as error:
            assert str(error) == "finish interrupted after repair"
        else:
            raise AssertionError("Apply finish interruption was not surfaced")
    finally:
        model_adapter.call_agent = original_call_agent
        apply_graph.application_package_error = validation
    model_adapter.call_agent = no_more_apply_calls
    try:
        recovered = runner.apply_evaluate(payload)
        assert runner.apply_evaluate(payload) == recovered
    finally:
        model_adapter.call_agent = original_call_agent
    assert recovered["artifact"] == complete_package and recovered["tool_calls"] == 2

split_reasoning = {"dimensions": {"compensation": {
    "score": None, "rationale": "No salary in JD", "evidence": [],
    "fact_to_inference": "No defensible estimate",
}}}
assert _normalize_assessment(split_reasoning)["dimensions"]["compensation"] == {
    "score": None, "rationale": "No salary in JD\nfact_to_inference: No defensible estimate", "evidence": [],
}

with tempfile.TemporaryDirectory(prefix="career-ops-runner-") as temporary:
    complete_sections = {name: "Evidence and next step." for name in (
        "overview", "capabilities", "compensation", "questions", "legitimacy", "risks", "checklist"
    )}
    responses = iter((
        {"direction": {}, "compensation": {}, "company": {}},
        {"direction": {}, "compensation": {}, "company": {}, "sections": complete_sections},
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
        calls_dir = Path(temporary) / "new-draft-root"
        repaired, _ = model_adapter.call_agent("repair", "prompt", [], calls_dir)
    finally:
        model_adapter.create_agent = original_create_agent
    assert repaired["sections"] == complete_sections
    assert len(calls) == 2
    assert len((calls_dir / "calls.jsonl").read_text().splitlines()) == 2

with tempfile.TemporaryDirectory(prefix="career-ops-section-completion-") as temporary:
    partial = {"dimensions": {}, "sections": {"overview": "Existing source-bound overview."}}
    missing = ("capabilities", "compensation", "questions", "legitimacy", "risks", "checklist")
    original_call_agent = model_adapter.call_agent
    seen = []
    def fill_sections(phase, prompt, *_args, **_kwargs):
        seen.append((phase, prompt))
        return {name: ["Grounded evidence.", "Next action."] if name in ("questions", "risks", "checklist")
                else "Grounded evidence and next action." for name in missing}, "sections-session"
    model_adapter.call_agent = fill_sections
    try:
        completed, count = score_graph._complete_sections(partial, {"jd": "Source JD"}, {}, {}, Path(temporary))
    finally:
        model_adapter.call_agent = original_call_agent
    assert count == 1 and completed["sections"]["overview"] == partial["sections"]["overview"]
    assert all(completed["sections"].get(name) for name in missing)
    assert completed["sections"]["questions"] == "- Grounded evidence.\n- Next action."
    assert seen[0][0] == "score_sections" and "Source JD" in seen[0][1]
    ready, count = score_graph._complete_sections(
        {"dimensions": {}, "sections": {**completed["sections"], "risks": ["Known risk."]}},
        {"jd": "Source JD"}, {}, {}, Path(temporary),
    )
    assert count == 0 and ready["sections"]["risks"] == "- Known risk."
    extra = {"dimensions": {}, "sections": {**ready["sections"],
             "Evaluation Checklist": "地点未披露；冻结来源没有页面快照。"}}
    bounded, count = score_graph._complete_sections(extra, {"jd": "Source JD"}, {}, {}, Path(temporary))
    assert count == 0 and bounded["sections"] == ready["sections"]

with tempfile.TemporaryDirectory(prefix="career-ops-dimension-completion-") as temporary:
    good = {"score": None, "rationale": "Evidence is insufficient for a rating.", "evidence": []}
    original = {name: dict(good) for name in ("direction", "company")}
    original["compensation"] = "Market benchmark does not prove this job's pay."
    original_call_agent = model_adapter.call_agent
    seen = []
    def repair_dimension(phase, prompt, *_args, **_kwargs):
        seen.append((phase, prompt))
        return dict(good), "dimension-session"
    model_adapter.call_agent = repair_dimension
    try:
        repaired, count = score_graph._complete_dimensions(
            {"dimensions": original}, {"jd": "Official JD"}, {}, {}, Path(temporary)
        )
    finally:
        model_adapter.call_agent = original_call_agent
    assert count == 1 and repaired["dimensions"]["compensation"] == good
    assert repaired["dimensions"]["direction"] == original["direction"]
    assert seen[0][0] == "score_dimension" and "Official JD" in seen[0][1]

with tempfile.TemporaryDirectory(prefix="career-ops-render-repair-", dir=ROOT / "data") as temporary:
    runner.DRAFT_ROOT = Path(temporary).relative_to(ROOT)
    jd = "Build developer tools and reviewed AI workflows."
    repair_inputs = {
        "jd_report": {
            "opportunity_id": "real-job", "url": "https://example.com/real-job",
            "company": "Example", "role": "Engineer", "jd": jd,
            "captured_at": "2026-09-24T00:00:00Z", "liveness_reason": "Official page active",
            "location_evidence": "Shanghai, China",
            "prescreen": {"status": "uncertain", "unknowns": ["compensation"]},
        },
        "cv": "Verified candidate facts.",
        "profile": "attractiveness:\n  model: attractiveness-v3\n",
        "targeting": "Verified targeting.", "rules": "Current rules.",
    }
    sections = {name: "Grounded analysis with explicit unknowns and next actions." for name in (
        "overview", "capabilities", "compensation", "questions", "legitimacy", "risks", "checklist"
    )}
    valid_dimensions = {
        "direction": {"score": 4, "rationale": "Direct evidence.", "evidence": [{"source": "jd", "quote": jd}]},
        "compensation": {"score": None, "rationale": "Unknown.", "evidence": []},
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
            "searched_at": "2026-09-24", "queries": ["compensation", "company"],
            "dimensions": {name: {"queries": [index], "conclusion": "Unknown.", "next_step": "Confirm."}
                           for index, name in enumerate(("compensation", "company"))},
            "findings": [],
        },
    }
    phases = []
    original_call_agent = model_adapter.call_agent
    def call_agent(phase, *_args, **_kwargs):
        phases.append(phase)
        if phase == "research":
            return research, "research-session"
        if phase == "score_sections":
            return {"risks": sections["risks"]}, "sections-session"
        dimensions = invalid_dimensions if phase == "assessment" else valid_dimensions
        bodies = {**sections, "risks": "岗位办公城市未披露。"} if phase == "repair" else sections
        return {"dimensions": dimensions, "sections": bodies}, f"{phase}-session"
    model_adapter.call_agent = call_agent
    try:
        rendered = runner.evaluate({"inputs": repair_inputs, "revision": 0})
    finally:
        model_adapter.call_agent = original_call_agent
    assert phases == ["research", "assessment", "repair", "score_sections"]
    phases.clear()
    model_adapter.call_agent = lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Completed score repeated"))
    try:
        assert runner.evaluate({"inputs": repair_inputs, "revision": 0}) == rendered
    finally:
        model_adapter.call_agent = original_call_agent
    assert phases == []
    assert rendered["artifact"]["type"] == "score"
    report_path = Path(rendered["artifact"]["draft_directory"]) / "report.md"
    report_path.unlink()
    cached = json.loads((report_path.parent / "assessment.json").read_text())
    cached["dimensions"] = invalid_dimensions
    cached["sources"] = [{"id": "web1", "text": "Forged research page"}]
    cached["research"]["findings"] = [{"id": "f1", "url": "https://example.com/forged", "entity": "Example",
                                         "status": "retrieved", "source": "web1", "quote": "Forged research page"}]
    (report_path.parent / "assessment.json").write_text(json.dumps(cached))
    phases.clear()
    model_adapter.call_agent = call_agent
    try:
        recovered = runner.evaluate({"inputs": repair_inputs, "revision": 0})
    finally:
        model_adapter.call_agent = original_call_agent
    assert phases == ["repair", "score_sections"]
    recovered_research = json.loads((report_path.parent / "assessment.json").read_text())
    assert recovered_research["sources"] == research["sources"]
    assert recovered_research["research"] == research["research"]
    assessment_path = report_path.parent / "assessment.json"
    cached = json.loads(assessment_path.read_text())
    cached["sections"]["Legacy heading"] = "Unused section from a model repair."
    assessment_path.write_text(json.dumps(cached))
    report_path.unlink()
    model_adapter.call_agent = lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Normalized score repeated a model call"))
    try:
        runner.evaluate({"inputs": repair_inputs, "revision": 0})
    finally:
        model_adapter.call_agent = original_call_agent
    assert "Legacy heading" not in json.loads(assessment_path.read_text())["sections"]

with tempfile.TemporaryDirectory(prefix="career-ops-research-recovery-", dir=ROOT / "data") as temporary:
    runner.DRAFT_ROOT = Path(temporary)
    phases = []
    def interrupted(phase, *_args, **_kwargs):
        phases.append(phase)
        if phase == "research":
            return research, "research-session"
        raise RuntimeError("assessment interrupted")
    model_adapter.call_agent = interrupted
    try:
        try:
            runner.evaluate({"inputs": repair_inputs})
        except RuntimeError as error:
            assert str(error) == "assessment interrupted"
        else:
            raise AssertionError("assessment interruption was not surfaced")
    finally:
        model_adapter.call_agent = original_call_agent
    assert phases == ["research", "assessment"]
    checkpoints = list(runner.DRAFT_ROOT.glob("*/score-checkpoints.db"))
    assert len(checkpoints) == 1
    for cached_research in runner.DRAFT_ROOT.glob("*/research-result*.json"):
        cached_research.unlink()
    def resumed(phase, *_args, **_kwargs):
        phases.append(phase)
        assert phase == "assessment"
        return {"dimensions": valid_dimensions, "sections": sections}, "assessment-session"
    model_adapter.call_agent = resumed
    try:
        runner.evaluate({"inputs": repair_inputs})
    finally:
        model_adapter.call_agent = original_call_agent
    assert phases == ["research", "assessment", "assessment"]

with tempfile.TemporaryDirectory(prefix="career-ops-repair-checkpoint-", dir=ROOT / "data") as temporary:
    runner.DRAFT_ROOT = Path(temporary)
    phases = []
    def repair_call(phase, *_args, **_kwargs):
        phases.append(phase)
        if phase == "research":
            return research, "research-session"
        dimensions = invalid_dimensions if phase == "assessment" else valid_dimensions
        return {"dimensions": dimensions, "sections": sections}, f"{phase}-session"
    original_render = score_graph.render_report
    render_calls = 0
    def interrupted_render(*args):
        global render_calls
        render_calls += 1
        if render_calls == 2:
            raise RuntimeError("report interrupted after repair")
        return original_render(*args)
    model_adapter.call_agent = repair_call
    score_graph.render_report = interrupted_render
    try:
        try:
            runner.evaluate({"inputs": repair_inputs})
        except RuntimeError as error:
            assert str(error) == "report interrupted after repair"
        else:
            raise AssertionError("Report interruption was not surfaced")
    finally:
        model_adapter.call_agent = original_call_agent
        score_graph.render_report = original_render
    assert phases == ["research", "assessment", "repair"]
    def no_more_model_calls(*_args, **_kwargs):
        raise AssertionError("Recovery repeated a completed model call")
    model_adapter.call_agent = no_more_model_calls
    try:
        assert runner.evaluate({"inputs": repair_inputs})["outcome"] == "score"
    finally:
        model_adapter.call_agent = original_call_agent

print("workflow model runner: rendered draft recovery avoids repeated research")
