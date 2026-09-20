"""Verify the public OII-330 score CLI contract across separate processes."""

import json
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "workflow" / "career_ops.py"
PYTHON = ROOT / "workflow" / ".venv" / "bin" / "python"


def run(directory: Path, *args: str, expected: int = 0, env: dict | None = None) -> dict:
    result = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), *args],
        text=True,
        capture_output=True,
        env={**os.environ, **(env or {})},
    )
    assert result.returncode == expected, (args, result.stdout, result.stderr)
    return json.loads(result.stdout)


with tempfile.TemporaryDirectory(prefix="career-ops-cli-") as temporary:
    directory = Path(temporary)
    completed = run(directory, "start", "score", "job-1", "jd-v1")
    assert completed["module"] == "score"
    assert completed["status"] == "completed"
    assert completed["allowed_actions"] == []

    shown = run(directory, "show", completed["task_id"])
    assert shown == completed
    assert run(directory, "show", "job-1") == completed
    assert run(directory, "list") == [completed]

    waiting = run(directory, "start", "score", "job-2", "jd-v1", "--corrections", "3")
    assert waiting["status"] == "waiting"
    assert waiting["reason"] == "review_budget_exhausted"
    assert waiting["allowed_actions"] == ["resume", "cancel"]
    cancelled = run(directory, "cancel", waiting["task_id"])
    assert cancelled["status"] == "cancelled"
    assert cancelled["allowed_actions"] == []

    duplicate = run(directory, "start", "score", "job-1", "jd-v1")
    assert duplicate == completed
    rejected = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "score", "job-1", "jd-v2"],
        text=True,
        capture_output=True,
    )
    assert rejected.returncode == 1 and "--re-evaluate" in rejected.stderr
    reevaluated = run(directory, "start", "score", "job-1", "jd-v2", "--re-evaluate")
    assert reevaluated["task_id"] != completed["task_id"]

    jd_report = directory / "jd-report.json"
    jd_report.write_text(json.dumps({
        "schema_version": "jd_report_v1",
        "opportunity_id": "job-real",
        "url": "https://example.com/job-real",
        "company": "Example",
        "role": "AI Engineer",
        "jd": "Build and review agent workflows.",
        "liveness": "active",
        "prescreen": {"status": "pass", "unknowns": ["compensation"]},
    }))
    runner = f"{PYTHON} {ROOT / 'tests' / 'fixtures' / 'workflow-model-runner.py'}"
    real = run(directory, "start", "score", "job-real", str(jd_report), env={"CAREER_OPS_MODEL_RUNNER": runner})
    assert real["artifact"]["outcome"] == "score"
    assert real["artifact"]["artifact"]["report"] == "# Verified score report"
    assert Path(real["artifact"]["artifact"]["path"]).read_text() == "# Verified score report"

    incomplete_report = directory / "incomplete-jd.json"
    incomplete_report.write_text(json.dumps({
        **json.loads(jd_report.read_text()),
        "opportunity_id": "job-incomplete",
        "prescreen": {"status": "incomplete", "missing": ["complete responsibilities"]},
    }))
    incomplete = run(directory, "start", "score", "job-incomplete", str(incomplete_report), env={"CAREER_OPS_MODEL_RUNNER": runner})
    assert incomplete["status"] == "waiting"
    assert incomplete["reason"] == "core_evidence_missing"
    resumed_incomplete = run(directory, "resume", incomplete["task_id"], "--input", str(incomplete_report), env={"CAREER_OPS_MODEL_RUNNER": runner})
    assert resumed_incomplete["status"] == "waiting" and resumed_incomplete["attempt"] == 2

    excluded_report = directory / "excluded-jd.json"
    excluded_report.write_text(json.dumps({
        **json.loads(jd_report.read_text()),
        "opportunity_id": "job-excluded",
        "prescreen": {"status": "fail", "reason": "Reliable JD evidence proves a mandatory location mismatch"},
    }))
    excluded = run(directory, "start", "score", "job-excluded", str(excluded_report), env={"CAREER_OPS_MODEL_RUNNER": runner})
    assert excluded["status"] == "completed"
    assert excluded["artifact"]["outcome"] == "exclude"

print("workflow CLI: start/show/list/resume/cancel contract passed")
