"""Verify score recovery and idempotent business commits at public boundaries."""

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.career_ops import BusinessStore, digest, resume_task

PYTHON = ROOT / "workflow" / ".venv" / "bin" / "python"
CLI = ROOT / "workflow" / "career_ops.py"


def call(directory: Path, *args: str, expected: int = 0, env: dict | None = None) -> dict:
    result = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), *args],
        text=True, capture_output=True, env={**os.environ, **(env or {})},
    )
    assert result.returncode == expected, (args, result.stdout, result.stderr)
    return json.loads(result.stdout) if result.stdout else {}


with tempfile.TemporaryDirectory(prefix="career-ops-recovery-") as temporary:
    directory = Path(temporary)
    inputs = directory / "inputs"
    (inputs / "config").mkdir(parents=True)
    (inputs / "modes").mkdir()
    (inputs / "cv.md").write_text("Candidate facts v1")
    (inputs / "config" / "profile.yml").write_text("language:\n  output: zh-CN\n")
    (inputs / "modes" / "_profile.md").write_text("Targeting")
    (inputs / "modes" / "_custom.md").write_text("Rules")
    runner = f"{PYTHON} {ROOT / 'tests' / 'fixtures' / 'workflow-model-runner.py'}"
    model_env = {"CAREER_OPS_MODEL_RUNNER": runner, "CAREER_OPS_INPUT_ROOT": str(inputs)}

    def report(opportunity: str) -> Path:
        path = directory / f"{opportunity}.json"
        path.write_text(json.dumps({
            "schema_version": "jd_report_v1", "opportunity_id": opportunity,
            "url": f"https://example.com/{opportunity}", "company": "Example", "role": "AI Engineer",
            "jd": "Build reviewed agent workflows.", "captured_at": "2026-09-21T00:00:00Z", "liveness": "active",
            "prescreen": {"status": "pass", "unknowns": ["compensation"]},
        }))
        return path

    call(directory, "start", "score", "review-crash", str(report("review-crash")), "--crash-at", "review", expected=86, env=model_env)
    crashed = call(directory, "list")[0]
    recovered = call(directory, "run", crashed["task_id"], "--crash-at", "review", env=model_env)
    assert recovered["status"] == "completed"

    call(directory, "start", "score", "publish-crash", str(report("publish-crash")), "--crash-at", "publish", expected=86, env=model_env)
    published = [task for task in call(directory, "list") if task["opportunity_id"] == "publish-crash"][0]
    assert published["status"] == "completed"
    reconciled = call(directory, "run", published["task_id"], "--crash-at", "publish", env=model_env)
    assert reconciled == published
    database = sqlite3.connect(directory / "opportunities.db")
    assert database.execute("SELECT count(*) FROM results WHERE task_id=?", (published["task_id"],)).fetchone()[0] == 1
    assert database.execute("SELECT count(*) FROM events WHERE task_id=? AND type='published'", (published["task_id"],)).fetchone()[0] == 1
    database.close()

    call_log = directory / "failed-calls.log"
    failed = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "score", "failed", str(report("failed"))],
        text=True, capture_output=True, env={
            **os.environ, **model_env, "WORKFLOW_TEST_RUNNER_FAIL": "1", "WORKFLOW_TEST_CALL_LOG": str(call_log)
        },
    )
    assert failed.returncode == 1
    assert call_log.read_text().splitlines() == ["evaluate"]
    isolated = call(directory, "start", "score", "isolated", str(report("isolated")), env=model_env)
    assert isolated["status"] == "completed"

    call(directory, "start", "score", "input-change", str(report("input-change")), "--crash-at", "review", expected=86, env=model_env)
    changed_task = next(task for task in call(directory, "list") if task["opportunity_id"] == "input-change")
    (inputs / "cv.md").write_text("Candidate facts v2")
    changed = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "run", changed_task["task_id"]],
        text=True, capture_output=True, env={**os.environ, **model_env},
    )
    assert changed.returncode == 1 and "changed before business commit" in changed.stderr
    assert call(directory, "show", changed_task["task_id"])["reason"] == "input_changed"

    lock_report = report("locked")
    running = subprocess.Popen(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "score", "locked", str(lock_report)],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={**os.environ, **model_env, "WORKFLOW_TEST_SLEEP": "2"},
    )
    locked_task_id = None
    for _ in range(40):
        if (directory / "opportunities.db").exists():
            database = sqlite3.connect(directory / "opportunities.db")
            row = database.execute("SELECT task_id FROM tasks WHERE opportunity_id='locked'").fetchone()
            database.close()
            if row:
                locked_task_id = row[0]
                break
        time.sleep(0.05)
    assert locked_task_id
    duplicate_runner = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "run", locked_task_id],
        text=True, capture_output=True, env={**os.environ, **model_env},
    )
    assert duplicate_runner.returncode == 1 and "already executing" in duplicate_runner.stderr
    stdout, stderr = running.communicate(timeout=10)
    assert running.returncode == 0, (stdout, stderr)

    store = BusinessStore(directory / "opportunities.db")
    pending = store.start("cancel-race", "scan", "{}")
    store.cancel(pending["task_id"])
    artifact = {"reason": "Closed", "evidence": "Verified source"}
    state = {"task_id": pending["task_id"], "input_hash": digest("{}"), "outcome": "exclude",
             "draft": json.dumps(artifact), "material_hash": digest(json.dumps(artifact)),
             "review": {"verdict": "approve", "checks": {"grounded": "pass"}}}
    try:
        store.publish(state)
    except ValueError as error:
        assert "no longer running" in str(error)
    else:
        raise AssertionError("Cancelled task published a result")
    assert store.task(pending["task_id"])["status"] == "cancelled"
    assert store.result(pending["task_id"]) is None
    for input_text in ("{}", '{"changed":true}'):
        stale = store.start(f"reset-race-{input_text}", "scan", "{}")
        store.wait(stale["task_id"], "user_deferred")
        observed = store.task(stale["task_id"])
        store.cancel(stale["task_id"])
        original_task = store.task
        reads = [observed]
        store.task = lambda task_id: reads.pop(0) if reads else original_task(task_id)
        try:
            store.reset_input(stale["task_id"], input_text)
        except ValueError as error:
            assert "no longer waiting" in str(error)
        else:
            raise AssertionError("Cancelled task was reopened from a stale waiting snapshot")
        finally:
            store.task = original_task
        assert store.task(stale["task_id"])["status"] == "cancelled"
    current_resume = store.start("current-resume-race", "scan", "{}")
    store.wait(current_resume["task_id"], "user_deferred")
    observed = store.task(current_resume["task_id"])
    store.cancel(current_resume["task_id"])
    original_task = store.task
    reads = [observed]
    store.task = lambda task_id: reads.pop(0) if reads else original_task(task_id)
    try:
        store.resume_current(current_resume["task_id"])
    except ValueError as error:
        assert "no longer waiting" in str(error)
    else:
        raise AssertionError("Cancelled current-input resume was accepted")
    finally:
        store.task = original_task
    failed_resume = store.start("failed-resume-race", "scan", "{}")
    store.wait(failed_resume["task_id"], "failure:RuntimeError")
    store.cancel(failed_resume["task_id"])
    try:
        store.resume_failed_checkpoint(failed_resume["task_id"])
    except ValueError as error:
        assert "no longer waiting" in str(error)
    else:
        raise AssertionError("Cancelled checkpoint resume was accepted")
    budget_task = store.start("attempt-budget", "apply", "{}")
    store.add_usage(budget_task["task_id"], 899, 19)
    store.wait(budget_task["task_id"], "user_review")
    continued = store.reset_input(budget_task["task_id"], '{"feedback":"revise"}')
    assert continued["elapsed_seconds"] == 899 and continued["tool_calls"] == 19
    assert continued["attempt_elapsed_seconds"] == 0 and continued["attempt_tool_calls"] == 0
    store.add_usage(budget_task["task_id"], 2, 1)
    store.wait(budget_task["task_id"], "failure:RuntimeError")
    recovered = store.resume_failed_checkpoint(budget_task["task_id"])
    assert recovered["attempt_elapsed_seconds"] == 2 and recovered["attempt_tool_calls"] == 1
    store.wait(budget_task["task_id"], "user_deferred")
    resumed = store.resume_current(budget_task["task_id"])
    assert resumed["elapsed_seconds"] == 901 and resumed["tool_calls"] == 20
    assert resumed["attempt_elapsed_seconds"] == 0 and resumed["attempt_tool_calls"] == 0
    feedback_task = store.start("feedback-rollback", "apply", "{}")
    store.wait(feedback_task["task_id"], "user_review")
    with patch("workflow.career_ops.current_apply_input", return_value="{}"), \
         patch.object(BusinessStore, "reset_input", side_effect=ValueError("simulated reset failure")):
        try:
            resume_task(directory, feedback_task["task_id"], None, None, feedback="Source-backed revision")
        except ValueError as error:
            assert "simulated reset failure" in str(error)
        else:
            raise AssertionError("Expected reset failure after feedback")
    assert store.feedback(feedback_task["task_id"]) == []
    assert store.task(feedback_task["task_id"])["status"] == "waiting"
    store.set_context(feedback_task["task_id"], "input_change", {"jd_report": {}, "diff": "changed JD"})
    with patch("workflow.career_ops.current_apply_input", return_value="{}"), \
         patch.object(BusinessStore, "reset_input", side_effect=ValueError("simulated JD reset failure")):
        try:
            resume_task(directory, feedback_task["task_id"], None, None, decision="accept-jd-change")
        except ValueError as error:
            assert "simulated JD reset failure" in str(error)
        else:
            raise AssertionError("Expected reset failure after JD choice")
    assert store.context(feedback_task["task_id"], "input_change") == {"jd_report": {}, "diff": "changed JD"}
    store.close()

print("workflow recovery: crash resume, commit reconciliation and job isolation passed")
