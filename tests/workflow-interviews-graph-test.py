"""Exercise interview graph review, feedback, source rejection and business recovery locally."""

import os
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.interviews import apply_review_patch, confirm, current_context, normalize_model_artifact, restore_markdown_quotes, resume, run_task, show, show_markdown, start, validate_artifact
from workflow.interview_model import prompt as interview_prompt
from workflow.interview_review import render_markdown
from workflow.career_ops import digest as text_digest
from workflow.interview_store import InterviewStore, digest as store_digest


for phase in ("draft", "review"):
    _, instruction = interview_prompt({"phase": phase, "kind": "prepare", "input": {}})
    assert ("decimal estimate" if phase == "draft" else "derived tenure estimate") in instruction
    assert "asynchronous-service practice" in instruction
    assert "microservice/cloud-native" in instruction or "microservices or cloud-native" in instruction
    assert "preparation_plan.requirements" in instruction
    assert "formal technical design documentation" in instruction
    assert "Python service" in instruction
    if phase == "draft":
        assert "never preparation_response" in instruction
        assert "do not omit risk_questions" in instruction
        assert "do not assume a fixed number of requirements" in instruction
        assert "all 25" not in instruction
    else:
        assert 'diagnostic label "JD requirements"' in instruction
        assert "Never request deleting or renaming a frozen label" in instruction
for phase in ("draft", "review"):
    _, instruction = interview_prompt({"phase": phase, "kind": "practice", "input": {}})
    assert "first-person suggested answer" in instruction
_, revision_instruction = interview_prompt({"phase": "revise", "kind": "prepare", "input": {}})
assert "Do not return a full artifact" in revision_instruction
practice_review = render_markdown({
    "task_id": "practice-review", "kind": "practice", "status": "waiting", "reason": "user_review",
    "artifact": {"version": 2, "approved": True, "artifact": {"sections": {
        "questions": {"question_zh": "如何设计 Agent？", "suggested_structure": ["先讲权限", "再讲评估"]},
        "answer_feedback": {"answer_status": "尚无本人作答", "suggested_answer": "这是建议回答"},
        "learning": {"summary": "没有已确认学习记录"},
    }, "claims": [{"text": "岗位要求 Agent", "source": "jd", "quote": "Agent"}]}},
}, {"opportunity": {"company": "Bosch", "role": "Agent Developer"}})
assert "# 面试练习稿" in practice_review and "建议回答（非本人作答）" in practice_review
assert "- 先讲权限" in practice_review and "来源：`jd`" in practice_review
assert "本文件是审阅稿" in practice_review and "没有已确认学习记录" in practice_review
assert practice_review.index("## 练习问题") < practice_review.index("## 建议回答与反馈")


context = {
    "opportunity": {"company": "Bosch", "role": "Agent Developer"},
    "candidate_sources": {"cv.md": "Experience in Python", "config/profile.yml": "language: zh-CN"},
    "story_bank": "### [Engineering] Python Delivery\n**Action:** Built a Python service.\n**Result:** Delivered a Python release.\n**Best for questions about:** Python, delivery\n",
    "results": {
        "scan": {"artifact": {"jd": "## Requirements\n- Python, FastAPI\n"}},
        "score": {"artifact": {"report": "| Python | Proven | CV |\n| FastAPI | Unverified | Ask recruiter |"}},
    },
}
runner = f"{sys.executable} {ROOT / 'tests' / 'fixtures' / 'workflow-interview-runner.py'}"
misplaced = {"kind": "prepare", "sections": {
    "claims": [{"subject": "candidate", "text": "Built it", "source": "cv.md", "quote": "Built it"}],
    "requirements": [{"requirement": "Python", "classification": "evidenced", "preparation_response": "Explain Python work"}],
}}
normalized = normalize_model_artifact(misplaced)
assert normalized["claims"] == misplaced["sections"]["claims"]
assert normalized["sections"]["requirements"] == [{
    "requirement": "Python", "classification": "evidenced", "response": "Explain Python work",
}]
assert "claims" not in normalized["sections"] and "claims" in misplaced["sections"]
patched = apply_review_patch({"sections": {"requirements": [
    {"requirement": "Python", "classification": "evidenced", "response": "Old"}],
    "timeline": "Day 1"}, "claims": []}, {"requirements": [
    {"requirement": "Python", "classification": "adjacent", "response": "Corrected"}]})
assert patched["sections"]["requirements"][0]["response"] == "Corrected"
assert patched["sections"]["timeline"] == "Day 1"
try:
    apply_review_patch(patched, {"requirements": [
        {"requirement": "JD requirements", "classification": "unverified", "response": "Delete"}]})
except ValueError as error:
    assert "frozen requirement labels" in str(error)
else:
    raise AssertionError("Review patch changed frozen labels")
try:
    apply_review_patch(patched, {"requirements": [
        {"requirement": "Python", "classification": "adjacent", "response": "Corrected", "extra": "unsafe"}]})
except ValueError as error:
    assert "frozen requirement labels" in str(error)
else:
    raise AssertionError("Review patch added unsupported requirement fields")
markdown_context = json.loads(json.dumps(context))
markdown_context["candidate_sources"]["cv.md"] = "- **Languages and frameworks:** Python, C, C++"
formatted = restore_markdown_quotes({"claims": [{
    "subject": "candidate", "text": "Python skill", "source": "cv.md",
    "quote": "Languages and frameworks: Python, C, C++",
}]}, markdown_context)
assert formatted["claims"][0]["quote"] == "Languages and frameworks:** Python, C, C++"
assert restore_markdown_quotes({"claims": [{
    "subject": "candidate", "text": "Fabricated skill", "source": "cv.md", "quote": "Python, Rust",
}]}, markdown_context)["claims"][0]["quote"] == "Python, Rust"
markdown_context["candidate_sources"]["cv.md"] += "\n- **Languages and frameworks:** Python, C, C++"
assert restore_markdown_quotes({"claims": [{
    "subject": "candidate", "text": "Python skill", "source": "cv.md",
    "quote": "Languages and frameworks: Python, C, C++",
}]}, markdown_context)["claims"][0]["quote"] == "Languages and frameworks: Python, C, C++"
named_context = json.loads(json.dumps(context))
named_context["candidate_sources"]["cv.md"] = "# Jiaming Zhang | 张家铭\nExperience in Python"
named_artifact = {"schema": "career-ops/interview-artifact", "schema_version": 1, "kind": "practice",
                  "sections": {"questions": "Python?", "answer_feedback": "Use CV", "learning": "Practice"},
                  "claims": [{"subject": "candidate", "text": "张佳明有Python经验", "source": "cv.md",
                              "quote": "Experience in Python"}]}
try:
    validate_artifact("practice", named_artifact, named_context)
except ValueError as error:
    assert "candidate's name" in str(error)
else:
    raise AssertionError("Incorrect candidate name passed source validation")
named_artifact["claims"][0]["text"] = "张家铭有Python经验"
validate_artifact("practice", named_artifact, named_context)
named_artifact["claims"][0]["text"] = "30+标注者处理7,000张去标识图像"
validate_artifact("practice", named_artifact, named_context)
with tempfile.TemporaryDirectory() as temporary, \
     patch.dict(os.environ, {"CAREER_OPS_INTERVIEW_RUNNER": runner, "CAREER_OPS_INTERVIEW_MODEL_ENABLED": "1",
                             "INTERVIEW_TEST_MARKDOWN_QUOTE": "1"}), \
     patch("workflow.interviews.current_context", return_value={
         **context, "candidate_sources": {**context["candidate_sources"],
                                           "cv.md": "- **Languages and frameworks:** Python"},
     }):
    repaired = start(Path(temporary), "7", "markdown-quote", "prepare", {})
    assert repaired["reason"] == "user_review" and repaired["model_calls"] == 2
    assert repaired["artifact"]["artifact"]["claims"][0]["quote"] == "Languages and frameworks:** Python"
bound_context = {
    "opportunity": {"id": 7, "url": "https://jobs.example/7", "company": "Bosch", "role": "Agent Developer"},
    "results": {
        "scan": {"outcome": "jd_report", "review": {}, "artifact": {
            "opportunity_id": "7", "url": "https://jobs.example/7", "company": "Bosch", "role": "Other Role",
        }},
        "score": {"outcome": "score", "review": {}, "input_hash": text_digest("score-input")},
    },
}
with patch("workflow.interviews.load_context", return_value=bound_context), \
     patch("workflow.interviews.workflow_review_approved", return_value=True), \
     patch("workflow.interviews.score_inputs", return_value="score-input"):
    try:
        current_context(Path("unused"), "7")
    except ValueError as error:
        assert "canonical opportunity" in str(error)
    else:
        raise AssertionError("Interview accepted a different role's reviewed scan")

with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"CAREER_OPS_INTERVIEW_RUNNER": runner, "CAREER_OPS_INTERVIEW_MODEL_ENABLED": "1"}), \
     patch("workflow.interviews.current_context", return_value=context):
    directory = Path(temporary)
    prepared = start(directory, "7", "round-1", "prepare", {"interview_at": "2026-10-01T10:00:00+08:00"})
    assert prepared["status"] == "waiting" and prepared["reason"] == "user_review"
    assert prepared["artifact"]["approved"]
    structured = json.loads(json.dumps(prepared["artifact"]["artifact"]))
    structured["sections"]["story_matches"] = {"DingTalk": "Source-backed story"}
    validate_artifact("prepare", structured, context)
    derived_tenure = json.loads(json.dumps(structured))
    derived_tenure["sections"]["requirements"][0]["response"] = "相关职业经历约3.4年"
    try:
        validate_artifact("prepare", derived_tenure, context)
    except ValueError as error:
        assert "derived decimal tenure" in str(error)
    else:
        raise AssertionError("Derived candidate tenure was accepted as a fact")
    misplaced = json.loads(json.dumps(structured))
    misplaced["sections"]["claims"] = misplaced.pop("claims")
    try:
        validate_artifact("prepare", misplaced, context)
    except ValueError as error:
        assert "claims must be top-level" in str(error)
    else:
        raise AssertionError("Nested interview claims were accepted")
    structured["sections"]["timeline"] = "   "
    try:
        validate_artifact("prepare", structured, context)
    except ValueError as error:
        assert "timeline must contain substantive content" in str(error)
    else:
        raise AssertionError("Whitespace-only interview section was accepted")
    structured["sections"]["timeline"] = {"status": "dates_unknown", "phases": [{"goal": "复核签证已核实"}]}
    try:
        validate_artifact("prepare", structured, context)
    except ValueError as error:
        assert "already confirmed" in str(error)
    else:
        raise AssertionError("Unresolved interview check was presented as confirmed")
    structured["sections"]["timeline"]["phases"][0]["goal"] = "核实是否支持签证"
    structured["sections"]["timeline"]["status_note"] = "未决项不得标记为已确认；不作已确认处理"
    validate_artifact("prepare", structured, context)
    structured["sections"]["timeline"]["phases"][0]["goal"] = "只总结同会话已确认信息"
    validate_artifact("prepare", structured, context)
    task_id = prepared["task_id"]
    store = InterviewStore(directory / "opportunities.db")
    draft = store.draft(task_id)
    outdated = json.loads(json.dumps(draft["artifact"]))
    outdated["sections"]["timeline"] = "复核签证已核实"
    store.db.execute("UPDATE interview_drafts SET artifact=?,artifact_hash=? WHERE task_id=? AND version=?",
                     (json.dumps(outdated, ensure_ascii=False), store_digest(outdated), task_id, draft["version"]))
    try:
        confirm(directory, task_id)
    except ValueError as error:
        assert "already confirmed" in str(error)
    else:
        raise AssertionError("Outdated reviewed interview draft was confirmed")
    store.db.execute("UPDATE interview_drafts SET artifact=?,artifact_hash=? WHERE task_id=? AND version=?",
                     (json.dumps(draft["artifact"], ensure_ascii=False), draft["artifact_hash"], task_id, draft["version"]))
    plan = json.loads(store.task(task_id)["input_payload"])["preparation_plan"]
    assert {item["requirement"]: item["classification"] for item in plan["requirements"]}["FastAPI"] == "unverified"
    validate_artifact("prepare", draft["artifact"], context, plan)
    missing = json.loads(json.dumps(draft["artifact"]))
    missing["sections"]["requirements"].pop()
    try:
        validate_artifact("prepare", missing, context, plan)
    except ValueError as error:
        assert "omits or duplicates" in str(error)
    else:
        raise AssertionError("Interview draft omitted a frozen plan requirement")
    hollow = json.loads(json.dumps(draft["artifact"]))
    hollow["sections"]["requirements"][0]["response"] = "  "
    try:
        validate_artifact("prepare", hollow, context, plan)
    except ValueError as error:
        assert "substantive frozen plan requirement" in str(error)
    else:
        raise AssertionError("Interview draft covered a requirement without preparation content")
    store.close()
    assert show(directory, task_id)["task_id"] == task_id
    readable = show_markdown(directory, task_id)
    assert "# 面试准备计划" in readable and "岗位要求与应对" in readable
    assert "独立审查：通过" in readable and "版本：v1" in readable
    assert start(directory, "7", "round-1", "prepare", {"interview_at": "2026-10-01T10:00:00+08:00"})["task_id"] == task_id
    try:
        resume(directory, task_id)
    except ValueError as error:
        assert "requires feedback" in str(error)
    else:
        raise AssertionError("Reviewed draft silently regenerated without feedback")
    with patch("workflow.interviews.current_context", return_value={"changed": True}):
        try:
            resume(directory, task_id, feedback="Revise an outdated draft")
        except ValueError as error:
            assert "sources changed" in str(error)
        else:
            raise AssertionError("Stale interview sources accepted feedback")
    store = InterviewStore(directory / "opportunities.db")
    assert store.feedback_history(task_id) == []
    assert store.draft(task_id)["approved"] and store.task(task_id)["status"] == "waiting"
    store.close()
    revised = resume(directory, task_id, feedback="Show the source quote in the story")
    assert revised["status"] == "waiting" and revised["artifact"]["version"] == 2
    assert confirm(directory, task_id)["status"] == "completed"
    assert confirm(directory, task_id)["status"] == "completed"
    with patch("workflow.interviews.current_context", return_value={"changed": True}):
        assert confirm(directory, task_id)["status"] == "completed"
    assert start(directory, "7", "round-1", "prepare", {"interview_at": "2026-10-01T10:00:00+08:00"})["task_id"] == task_id
    store = InterviewStore(directory / "opportunities.db")
    assert len(store.history("7", "round-1")) == 1
    store.close()
    recheck_task = start(directory, "7", "round-recheck", "prepare", {})
    store = InterviewStore(directory / "opportunities.db")
    store.db.execute("UPDATE interview_drafts SET approved=0 WHERE task_id=?", (recheck_task["task_id"],))
    store.db.execute("UPDATE interview_tasks SET waiting_reason='review_budget_exhausted' WHERE task_id=?",
                     (recheck_task["task_id"],))
    store.close()
    with patch.dict(os.environ, {"INTERVIEW_TEST_FAIL_DRAFT": "1"}):
        rechecked = resume(directory, recheck_task["task_id"], recheck=True)
    assert rechecked["reason"] == "user_review" and rechecked["artifact"]["approved"]
    assert rechecked["artifact"]["version"] == 2
    confirm(directory, recheck_task["task_id"])
    practice = start(directory, "7", "round-1", "practice", {"answer": "I used Python for the cited project."})
    assert practice["status"] == "waiting"
    confirm(directory, practice["task_id"])
    matched = start(directory, "7", "round-match", "practice", {"question": "Tell me about Python delivery"})
    store = InterviewStore(directory / "opportunities.db")
    assert json.loads(store.task(matched["task_id"])["input_payload"])["story_matches"][0]["story"]["title"] == "Python Delivery"
    store.close()
    for empty_transcript in ({}, {"transcript": "   "}, {"transcript": []}):
        try:
            start(directory, "7", "round-1", "debrief", empty_transcript)
        except ValueError as error:
            assert "transcript" in str(error)
        else:
            raise AssertionError("Debrief without a real transcript was accepted")
    debrief = start(directory, "7", "round-1", "debrief", {"transcript": "Interviewer: Python? Candidate: I used it."})
    confirm(directory, debrief["task_id"])
    learning = start(directory, "7", "round-1", "learn", {})
    assert learning["status"] == "waiting"
    confirm(directory, learning["task_id"])
    assert start(directory, "7", "round-1", "learn", {})["task_id"] == learning["task_id"]
    more_practice = start(directory, "7", "round-1", "practice", {"question": "How did you test Python?"})
    confirm(directory, more_practice["task_id"])
    refreshed_learning = start(directory, "7", "round-1", "learn", {})
    assert refreshed_learning["task_id"] != learning["task_id"]
    assert start(directory, "7", "round-1", "learn", {})["task_id"] == refreshed_learning["task_id"]
    store = InterviewStore(directory / "opportunities.db")
    refreshed_input = json.loads(store.task(refreshed_learning["task_id"])["input_payload"])
    assert more_practice["task_id"] in {item["task_id"] for item in refreshed_input["history"]}
    store.close()
    store = InterviewStore(directory / "opportunities.db")
    assert [item["kind"] for item in store.history("7", "round-1")] == ["prepare", "practice", "debrief", "learn", "practice"]
    store.close()

    with patch.dict(os.environ, {"INTERVIEW_TEST_BAD_QUOTE": "1"}):
        rejected = start(directory, "7", "round-2", "practice", {"question": "Describe your Python work"})
        assert rejected["reason"] == "review_budget_exhausted"
        assert "quote is absent" in rejected["artifact"]["review"]["required_changes"][0]
        try:
            confirm(directory, rejected["task_id"])
        except ValueError as error:
            assert "not approved" in str(error)
        else:
            raise AssertionError("Fabricated source quote was confirmed")
    store = InterviewStore(directory / "opportunities.db")
    failed = store.db.execute("SELECT task_id FROM interview_tasks WHERE session_key='round-2'").fetchone()[0]
    assert store.task(failed)["waiting_reason"] == "review_budget_exhausted"
    store.close()

    with patch.dict(os.environ, {"INTERVIEW_TEST_EMPTY_SECTION": "1"}):
        empty = start(directory, "7", "round-empty", "practice", {"question": "Describe your Python work"})
    assert empty["reason"] == "review_budget_exhausted"
    assert "answer_feedback must contain substantive content" in empty["artifact"]["review"]["required_changes"][0]
    assert not empty["artifact"]["approved"]

    with patch.dict(os.environ, {"INTERVIEW_TEST_BAD_SUBJECT": "1"}):
        crossed = start(directory, "7", "round-subject", "practice", {"question": "Describe Python work"})
    assert crossed["reason"] == "review_budget_exhausted"
    assert "subject='Python work'" in crossed["artifact"]["review"]["required_changes"][0]
    assert not crossed["artifact"]["approved"]

    with patch.dict(os.environ, {"INTERVIEW_TEST_REVISE_ONCE": "1"}):
        changed = start(directory, "7", "round-3", "prepare", {"interview_at": "2026-10-02T10:00:00+08:00"})
    assert changed["model_calls"] == 4
    assert changed["artifact"]["review"]["verdict"] == "approve"

    with patch.dict(os.environ, {"INTERVIEW_TEST_MALFORMED_REVIEW_ONCE": "1"}):
        format_retry = start(directory, "7", "round-review-format", "prepare", {})
    assert format_retry["status"] == "waiting" and format_retry["reason"] == "user_review"
    assert format_retry["model_calls"] == 3

    with patch.dict(os.environ, {"INTERVIEW_TEST_REVISE_ONCE": "1", "INTERVIEW_TEST_FAIL_REVISION": "1"}):
        try:
            start(directory, "7", "round-resume", "prepare", {})
        except RuntimeError as error:
            assert "transient draft failure" in str(error)
        else:
            raise AssertionError("Expected transient draft failure")
    store = InterviewStore(directory / "opportunities.db")
    interrupted = store.db.execute("SELECT task_id FROM interview_tasks WHERE session_key='round-resume'").fetchone()[0]
    assert store.task(interrupted)["model_calls"] == 3
    store.close()

    def competing_resume(*_args):
        concurrent = InterviewStore(directory / "opportunities.db")
        concurrent.db.execute(
            "UPDATE interview_tasks SET status='running',waiting_reason=NULL,attempt=attempt+1 WHERE task_id=?",
            (interrupted,),
        )
        concurrent.close()
        return context

    with patch("workflow.interviews.current_context", side_effect=competing_resume), \
         patch("workflow.interviews.run_task", side_effect=AssertionError("Duplicate resume reached graph")):
        try:
            resume(directory, interrupted)
        except ValueError as error:
            assert "already advanced" in str(error)
        else:
            raise AssertionError("Concurrent interview resume was accepted")
    store = InterviewStore(directory / "opportunities.db")
    store.db.execute(
        "UPDATE interview_tasks SET status='waiting',waiting_reason='failure:RuntimeError',attempt=1 WHERE task_id=?",
        (interrupted,),
    )
    store.close()
    with patch.dict(os.environ, {"INTERVIEW_TEST_REVISE_ONCE": "1"}):
        resumed = resume(directory, interrupted)
    assert resumed["status"] == "waiting" and resumed["reason"] == "user_review"
    assert resumed["attempt"] == 1 and resumed["model_calls"] == 5

    saved_stage = InterviewStore.stage

    def crash_after_business_commit(store, *args):
        saved_stage(store, *args)
        raise SystemExit("simulated crash before graph checkpoint")

    with patch.object(InterviewStore, "stage", crash_after_business_commit):
        try:
            start(directory, "7", "round-crash", "prepare", {})
        except SystemExit:
            pass
        else:
            raise AssertionError("Expected checkpoint-window crash")
    store = InterviewStore(directory / "opportunities.db")
    crash_task = store.db.execute("SELECT task_id,model_calls FROM interview_tasks WHERE session_key='round-crash'").fetchone()
    assert store.task(crash_task["task_id"])["status"] == "waiting"
    store.close()
    assert run_task(directory, crash_task["task_id"])["model_calls"] == crash_task["model_calls"]

    with patch("workflow.interviews.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "", "")):
        try:
            start(directory, "7", "round-empty-runner", "prepare", {})
        except RuntimeError as error:
            assert "runner returned no JSON" in str(error)
        else:
            raise AssertionError("Empty model-runner output was accepted")

    with patch.dict(os.environ, {"CAREER_OPS_INTERVIEW_RUNNER": "", "CAREER_OPS_INTERVIEW_MODEL_ENABLED": "0"}), \
         patch.object(subprocess, "run", side_effect=AssertionError("external call attempted")):
        try:
            start(directory, "7", "round-disabled", "prepare", {})
        except RuntimeError as error:
            assert "disabled pending interview-data authorization" in str(error)
        else:
            raise AssertionError("Unauthorised interview model use was accepted")
print("interview graph: reviewed draft, revision, confirmation and quote rejection passed")
