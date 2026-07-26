from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from career_ops_cli.cli import app
from career_ops_cli.profile import load_profile
from career_ops_cli.scanner import load_jobs
from career_ops_cli.scoring import score_job
from career_ops_cli.tailoring import create_tailoring_draft

MOCK_JOBS = Path("examples/mock/jobs.yml")
MOCK_PROFILE = Path("examples/mock/profile.yml")


def test_tailoring_draft_is_not_final_and_requires_approval() -> None:
    profile = load_profile(MOCK_PROFILE)
    job = next(job for job in load_jobs(MOCK_JOBS) if job.job_id == "mock-job-001")
    score = score_job(profile, job)

    draft = create_tailoring_draft(profile, job, score)

    assert draft.is_final is False
    assert draft.approval_required is True
    assert draft.evidence_ids
    assert "Draft only" in draft.summary


def test_tailoring_labels_gaps_without_claiming_them() -> None:
    profile = load_profile(MOCK_PROFILE)
    job = next(job for job in load_jobs(MOCK_JOBS) if job.job_id == "mock-job-003")
    score = score_job(profile, job)

    draft = create_tailoring_draft(profile, job, score)

    assert "Git" in draft.gaps
    gap_bullets = [bullet for bullet in draft.bullets if bullet.startswith("Known gaps")]
    assert gap_bullets == ["Known gaps to avoid claiming: Git, structured logging."]
    evidence_bullets = [bullet for bullet in draft.bullets if bullet.startswith("Use evidence")]
    assert all("Git" not in bullet for bullet in evidence_bullets)


def test_cli_tailor_json_output() -> None:
    result = CliRunner().invoke(
        app,
        [
            "tailor",
            "--jobs",
            str(MOCK_JOBS),
            "--profile",
            str(MOCK_PROFILE),
            "--job-id",
            "mock-job-001",
            "--json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    draft = payload["draft"]
    assert draft["job_id"] == "mock-job-001"
    assert draft["is_final"] is False
    assert draft["approval_required"] is True
    assert "ev-cli-001" in draft["evidence_ids"]


def test_cli_tailor_human_output_mentions_approval_gate() -> None:
    result = CliRunner().invoke(
        app,
        [
            "tailor",
            "--jobs",
            str(MOCK_JOBS),
            "--profile",
            str(MOCK_PROFILE),
            "--job-id",
            "mock-job-003",
        ],
    )

    assert result.exit_code == 0
    assert "approval required: True" in result.output
    assert "Known gaps to avoid claiming: Git, structured logging." in result.output


def test_cli_tailor_rejects_unknown_job_id() -> None:
    result = CliRunner().invoke(
        app,
        [
            "tailor",
            "--jobs",
            str(MOCK_JOBS),
            "--profile",
            str(MOCK_PROFILE),
            "--job-id",
            "missing-job",
        ],
    )

    assert result.exit_code != 0
    assert "No job found" in result.output
