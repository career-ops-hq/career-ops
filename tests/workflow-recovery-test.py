"""Verify score recovery and idempotent business commits at public boundaries."""

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
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

print("workflow recovery: crash resume, commit reconciliation and job isolation passed")
