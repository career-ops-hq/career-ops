"""Verify score recovery and idempotent business commits at public boundaries."""

import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / "workflow" / ".venv" / "bin" / "python"
CLI = ROOT / "workflow" / "career_ops.py"


def call(directory: Path, *args: str, expected: int = 0) -> dict:
    result = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), *args],
        text=True, capture_output=True,
    )
    assert result.returncode == expected, (args, result.stdout, result.stderr)
    return json.loads(result.stdout) if result.stdout else {}


with tempfile.TemporaryDirectory(prefix="career-ops-recovery-") as temporary:
    directory = Path(temporary)

    call(directory, "start", "score", "review-crash", "v1", "--crash-at", "review", expected=86)
    crashed = call(directory, "list")[0]
    recovered = call(directory, "run", crashed["task_id"], "--crash-at", "review")
    assert recovered["status"] == "completed"

    call(directory, "start", "score", "publish-crash", "v1", "--crash-at", "publish", expected=86)
    published = [task for task in call(directory, "list") if task["opportunity_id"] == "publish-crash"][0]
    assert published["status"] == "completed"
    reconciled = call(directory, "run", published["task_id"], "--crash-at", "publish")
    assert reconciled == published
    database = sqlite3.connect(directory / "opportunities.db")
    assert database.execute("SELECT count(*) FROM results WHERE task_id=?", (published["task_id"],)).fetchone()[0] == 1
    assert database.execute("SELECT count(*) FROM events WHERE task_id=? AND type='published'", (published["task_id"],)).fetchone()[0] == 1
    database.close()

    failed = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "score", "failed", "v1", "--scenario", "raise"],
        text=True, capture_output=True,
    )
    assert failed.returncode == 1
    isolated = call(directory, "start", "score", "isolated", "v1")
    assert isolated["status"] == "completed"

print("workflow recovery: crash resume, commit reconciliation and job isolation passed")
