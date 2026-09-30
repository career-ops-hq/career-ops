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
    inputs = directory / "inputs"
    (inputs / "config").mkdir(parents=True)
    (inputs / "modes").mkdir()
    (inputs / "cv.md").write_text("Verified candidate facts v1")
    (inputs / "config" / "profile.yml").write_text(
        "language:\n  output: zh-CN\nattractiveness:\n  model: attractiveness-v3\n"
    )
    (inputs / "modes" / "_profile.md").write_text("Verified targeting")
    (inputs / "modes" / "_custom.md").write_text("Current evaluation rules")
    runner = f"{PYTHON} {ROOT / 'tests' / 'fixtures' / 'workflow-model-runner.py'}"
    model_env = {"CAREER_OPS_MODEL_RUNNER": runner, "CAREER_OPS_INPUT_ROOT": str(inputs)}

    def report(opportunity: str, jd: str = "Build and review agent workflows.", status: str = "pass") -> Path:
        path = directory / f"{opportunity}.json"
        path.write_text(json.dumps({
            "schema_version": "jd_report_v1", "opportunity_id": opportunity,
            "url": f"https://example.com/{opportunity}", "company": "Example", "role": "AI Engineer",
            "jd": jd, "captured_at": "2026-09-21T00:00:00Z", "liveness": "active", "prescreen": {"status": status, "unknowns": ["compensation"]},
        }))
        return path

    job1 = report("job-1")
    completed = run(directory, "start", "score", "job-1", str(job1), env=model_env)
    assert completed["module"] == "score"
    assert completed["status"] == "completed"
    assert completed["allowed_actions"] == []

    shown = run(directory, "show", completed["task_id"])
    assert shown == completed
    assert run(directory, "show", "job-1") == completed
    assert run(directory, "list") == [completed]

    second = run(directory, "start", "score", "job-2", str(report("job-2")), env=model_env)
    assert second["status"] == "completed"
    duplicate = run(directory, "start", "score", "job-1", str(job1), env=model_env)
    assert duplicate == completed
    rejected = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "score", "job-1", str(report("job-1", "Changed JD"))],
        text=True,
        capture_output=True,
        env={**os.environ, **model_env},
    )
    assert rejected.returncode == 1 and "--re-evaluate" in rejected.stderr
    reevaluated = run(directory, "start", "score", "job-1", str(report("job-1", "Changed JD")), "--re-evaluate", env=model_env)
    assert reevaluated["task_id"] != completed["task_id"]

    jd_report = directory / "jd-report.json"
    jd_report.write_text(json.dumps({
        "schema_version": "jd_report_v1",
        "opportunity_id": "job-real",
        "url": "https://example.com/job-real",
        "company": "Example",
        "role": "AI Engineer",
        "jd": "Build and review agent workflows.",
        "captured_at": "2026-09-21T00:00:00Z",
        "liveness": "active",
        "prescreen": {"status": "pass", "unknowns": ["compensation"]},
    }))
    real = run(directory, "start", "score", "job-real", str(jd_report), env={
        **model_env,
        "WORKFLOW_TEST_DRAFT_DIRECTORY": str(directory / "draft"),
    })
    assert real["artifact"]["outcome"] == "score"
    assert real["artifact"]["artifact"]["report"] == "# Verified score report"
    assert Path(real["artifact"]["artifact"]["path"]).read_text() == "# Verified score report"
    assert "review_path" not in real["artifact"]["artifact"]

    incomplete_report = directory / "incomplete-jd.json"
    incomplete_report.write_text(json.dumps({
        **json.loads(jd_report.read_text()),
        "opportunity_id": "job-incomplete",
        "prescreen": {"status": "incomplete", "missing": ["complete responsibilities"]},
    }))
    incomplete = run(directory, "start", "score", "job-incomplete", str(incomplete_report), env=model_env)
    assert incomplete["status"] == "waiting"
    assert incomplete["reason"] == "core_evidence_missing"
    resumed_incomplete = run(directory, "resume", incomplete["task_id"], "--input", str(incomplete_report), env=model_env)
    assert resumed_incomplete["status"] == "waiting" and resumed_incomplete["attempt"] == 2

    excluded_report = directory / "excluded-jd.json"
    excluded_report.write_text(json.dumps({
        **json.loads(jd_report.read_text()),
        "opportunity_id": "job-excluded",
        "prescreen": {"status": "fail", "reason": "Reliable JD evidence proves a mandatory location mismatch", "evidence": ["Official JD: contractor only"]},
    }))
    excluded = run(directory, "start", "score", "job-excluded", str(excluded_report), env=model_env)
    assert excluded["status"] == "completed"
    assert excluded["artifact"]["outcome"] == "exclude"

    uncertain_report = report("job-uncertain", status="uncertain")
    uncertain = run(directory, "start", "score", "job-uncertain", str(uncertain_report), env=model_env)
    assert uncertain["status"] == "completed" and uncertain["artifact"]["outcome"] == "score"

    arbitrary = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "score", "bad", "arbitrary text"],
        text=True, capture_output=True,
    )
    assert arbitrary.returncode == 1 and "jd_report_v1" in arbitrary.stderr

    scores = run(directory, "scores", env=model_env)
    assert {item["opportunity_id"] for item in scores if item["valid"]} == {"job-1", "job-2", "job-real", "job-uncertain"}
    assert all(set(item) == {"opportunity_id", "scores", "valid", "stale_reason"} for item in scores)
    decisions = run(directory, "decisions", env=model_env)
    assert {item["opportunity_id"] for item in decisions["decisions"] if item["action"] == "focus"} == {
        "job-1", "job-2", "job-real", "job-uncertain"
    }
    assert decisions["stale"] == []
    reevaluated = run(
        directory, "start", "score", "job-2", str(report("job-2")), "--re-evaluate", env=model_env
    )
    assert reevaluated["status"] == "completed"
    assert reevaluated["task_id"] == second["task_id"]
    cancelled = run(directory, "cancel", second["task_id"])
    assert cancelled["status"] == "completed"
    assert cancelled["allowed_actions"] == []
    terminal_resume = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "resume", second["task_id"], "--input", str(report("job-2"))],
        text=True, capture_output=True, env={**os.environ, **model_env},
    )
    assert terminal_resume.returncode == 1 and "Terminal task cannot resume" in terminal_resume.stderr
    (inputs / "cv.md").write_text("Verified candidate facts v2")
    stale = run(directory, "scores", env=model_env)
    assert stale and all(not item["valid"] and item["stale_reason"] == "candidate_or_policy_inputs_changed" for item in stale)
    assert run(directory, "decisions", env=model_env)["decisions"] == []

print("workflow CLI: start/show/list/resume/cancel contract passed")
