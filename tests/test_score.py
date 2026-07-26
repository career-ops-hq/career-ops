from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from career_ops_cli.cli import app
from career_ops_cli.profile import load_profile
from career_ops_cli.scanner import load_jobs
from career_ops_cli.scoring import score_job, validate_rubric_weights

MOCK_JOBS = Path("examples/mock/jobs.yml")
MOCK_PROFILE = Path("examples/mock/profile.yml")


def test_rubric_weights_sum_to_one() -> None:
    assert validate_rubric_weights()


def test_strong_match_scores_above_weaker_match() -> None:
    profile = load_profile(MOCK_PROFILE)
    jobs = load_jobs(MOCK_JOBS)

    scored = {job.job_id: score_job(profile, job) for job in jobs}

    assert scored["mock-job-001"].total > scored["mock-job-002"].total
    assert scored["mock-job-001"].recommendation == "strong_match"
    assert scored["mock-job-002"].recommendation == "stretch"


def test_score_reports_required_skill_gaps() -> None:
    profile = load_profile(MOCK_PROFILE)
    job = next(job for job in load_jobs(MOCK_JOBS) if job.job_id == "mock-job-003")

    score = score_job(profile, job)

    assert "Git" in score.gaps["required_skills"]
    assert "Python" in score.matches["required_skills"]
    assert score.matches["evidence_ids"]


def test_cli_score_json_output() -> None:
    result = CliRunner().invoke(
        app,
        ["score", "--jobs", str(MOCK_JOBS), "--profile", str(MOCK_PROFILE), "--json"],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["candidate_id"] == "mock-candidate-001"
    assert payload["count"] == 3
    assert payload["scores"][0]["dimensions"][0]["name"] == "role_alignment"
    assert payload["scores"][0]["score"] >= 85


def test_cli_score_can_select_one_job() -> None:
    result = CliRunner().invoke(
        app,
        [
            "score",
            "--jobs",
            str(MOCK_JOBS),
            "--profile",
            str(MOCK_PROFILE),
            "--job-id",
            "mock-job-003",
        ],
    )

    assert result.exit_code == 0
    assert "Scored 1 job(s)" in result.output
    assert "mock-job-003" in result.output
    assert "required gaps: Git" in result.output
