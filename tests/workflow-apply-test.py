"""Verify apply package HITL, invalidation and cross-process confirmation."""

import json
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / "workflow" / ".venv" / "bin" / "python"
CLI = ROOT / "workflow" / "career_ops.py"
RUNNER = f"{PYTHON} {ROOT / 'tests' / 'fixtures' / 'workflow-model-runner.py'}"


def call(directory: Path, input_root: Path, *args: str, expected: int = 0) -> dict:
    result = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), *args],
        text=True, capture_output=True,
        env={**os.environ, "CAREER_OPS_MODEL_RUNNER": RUNNER, "CAREER_OPS_INPUT_ROOT": str(input_root)},
    )
    assert result.returncode == expected, (args, result.stdout, result.stderr)
    return json.loads(result.stdout) if result.stdout else {}


def source(path: Path, opportunity: str, jd: str) -> Path:
    path.write_text(json.dumps({
        "schema_version": "scan_input_v1", "opportunity_id": opportunity,
        "url": f"https://example.com/{opportunity}", "company": "Example", "role": "AI Engineer",
        "captured_at": "2026-09-20T04:00:00Z", "liveness": "active", "jd": jd,
    }))
    return path


with tempfile.TemporaryDirectory(prefix="career-ops-apply-") as temporary:
    root = Path(temporary)
    directory = root / "workflow"
    inputs = root / "inputs"
    (inputs / "config").mkdir(parents=True)
    (inputs / "modes").mkdir()
    (inputs / "prompts" / "applications").mkdir(parents=True)
    (inputs / "cv.md").write_text("Verified candidate facts")
    (inputs / "config" / "profile.yml").write_text("language:\n  output: zh-CN\n")
    (inputs / "modes" / "_profile.md").write_text("Target AI roles")
    (inputs / "modes" / "_custom.md").write_text("Never invent claims")
    (inputs / "prompts" / "applications" / "workflow.md").write_text("Prepare resume and application materials; never submit.")

    first = source(root / "first.json", "job-1", "Build reviewed AI agents.")
    call(directory, inputs, "start", "scan", "job-1", str(first))
    call(directory, inputs, "start", "score", "job-1", "scan:job-1")
    draft = call(directory, inputs, "start", "apply", "job-1", "score:job-1")
    assert draft["status"] == "waiting" and draft["reason"] == "user_review"
    assert draft["allowed_actions"] == ["feedback", "confirm", "defer", "cancel"]
    assert draft["artifact"]["review"]["verdict"] == "approve"
    assert Path(draft["artifact"]["files"]["resume_payload"]).is_file()
    assert Path(draft["artifact"]["files"]["cover_letter"]).is_file()
    assert "application_answers" not in draft["artifact"]["files"]

    deferred = call(directory, inputs, "resume", draft["task_id"], "--decision", "defer")
    assert deferred["status"] == "waiting" and deferred["reason"] == "user_deferred"
    confirmed = call(directory, inputs, "resume", draft["task_id"], "--decision", "confirm")
    assert confirmed["status"] == "completed"
    assert confirmed["artifact"]["outcome"] == "package_confirmed"
    assert call(directory, inputs, "resume", draft["task_id"], "--decision", "confirm") == confirmed

    second = source(root / "second.json", "job-2", "Build agent workflows.")
    call(directory, inputs, "start", "scan", "job-2", str(second))
    call(directory, inputs, "start", "score", "job-2", "scan:job-2")
    second_draft = call(directory, inputs, "start", "apply", "job-2", "score:job-2")
    ownership_probe = source(root / "ownership.json", "job-2", "Build changed agent workflows.")
    call(directory, inputs, "start", "scan", "job-2", str(ownership_probe), "--re-evaluate", expected=1)
    assert call(directory, inputs, "show", second_draft["task_id"])["status"] == "waiting"
    revised = call(directory, inputs, "resume", second_draft["task_id"], "--feedback", "Emphasize verified testing work")
    assert revised["status"] == "waiting" and revised["attempt"] == 2
    assert revised["artifact"]["version"] == 2

    (inputs / "cv.md").write_text("Verified candidate facts changed")
    invalid = call(directory, inputs, "show", second_draft["task_id"])
    assert invalid["reason"] == "input_changed"
    rejected = call(directory, inputs, "resume", second_draft["task_id"], "--decision", "confirm", expected=1)
    refreshed = call(directory, inputs, "resume", second_draft["task_id"], "--feedback", "Regenerate for current facts")
    assert refreshed["attempt"] == 3 and refreshed["artifact"]["version"] == 3

    changed_jd = root / "changed-jd.json"
    changed_jd.write_text(json.dumps({
        "schema_version": "jd_report_v1", "opportunity_id": "job-2",
        "url": "https://example.com/job-2", "company": "Example", "role": "AI Engineer",
        "captured_at": "2026-09-21T00:00:00Z", "liveness": "active", "jd": "Build agent workflows and production evaluation.",
        "prescreen": {"status": "pass"},
    }))
    changed = call(directory, inputs, "resume", second_draft["task_id"], "--input", str(changed_jd))
    assert changed["reason"] == "jd_changed" and changed["input_change"]["diff"]
    accepted = call(directory, inputs, "resume", second_draft["task_id"], "--decision", "accept-jd-change")
    assert accepted["status"] == "waiting" and accepted["artifact"]["version"] == 4
    cancelled = call(directory, inputs, "cancel", second_draft["task_id"])
    assert cancelled["status"] == "cancelled"

    third = source(root / "third.json", "job-3", "Build reliable AI agents.")
    call(directory, inputs, "start", "scan", "job-3", str(third))
    call(directory, inputs, "start", "score", "job-3", "scan:job-3")
    crashed = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "apply", "job-3", "score:job-3", "--crash-at", "review"],
        text=True, capture_output=True,
        env={**os.environ, "CAREER_OPS_MODEL_RUNNER": RUNNER, "CAREER_OPS_INPUT_ROOT": str(inputs)},
    )
    assert crashed.returncode == 86
    crashed_task = next(task for task in call(directory, inputs, "list") if task["opportunity_id"] == "job-3" and task["module"] == "apply")
    recovered = call(directory, inputs, "run", crashed_task["task_id"], "--crash-at", "review")
    assert recovered["status"] == "waiting" and recovered["reason"] == "user_review"
    review_failed = call(directory, inputs, "resume", crashed_task["task_id"], "--feedback", "force-review-failure")
    assert review_failed["reason"] == "review_budget_exhausted"
    assert review_failed["artifact"]["approved"] is False
    budgeted = call(directory, inputs, "resume", crashed_task["task_id"], "--feedback", "force-budget")
    assert budgeted["reason"] == "tool_budget_exhausted"
    assert budgeted["artifact"]["approved"] is False

print("workflow apply: package HITL, invalidation, JD choice and confirmation passed")
