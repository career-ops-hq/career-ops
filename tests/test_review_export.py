from __future__ import annotations

import json
from pathlib import Path

import yaml
from typer.testing import CliRunner

from career_ops_cli.cli import app
from career_ops_cli.exporter import APPROVAL_PHRASE, ExportGateError, export_artifacts
from career_ops_cli.profile import load_profile
from career_ops_cli.safety import review_draft
from career_ops_cli.scanner import load_jobs
from career_ops_cli.scoring import score_job
from career_ops_cli.tailoring import TailoringDraft, create_tailoring_draft

MOCK_JOBS = Path("examples/mock/jobs.yml")
MOCK_PROFILE = Path("examples/mock/profile.yml")


def _profile_job_score(job_id: str = "mock-job-003"):
    profile = load_profile(MOCK_PROFILE)
    job = next(job for job in load_jobs(MOCK_JOBS) if job.job_id == job_id)
    score = score_job(profile, job)
    return profile, job, score


def test_review_passes_safe_tailoring_draft() -> None:
    profile, job, score = _profile_job_score()
    draft = create_tailoring_draft(profile, job, score)

    result = review_draft(profile, score, draft)

    assert result.passed is True
    assert result.issues == ()


def test_review_blocks_claiming_known_gap() -> None:
    profile, job, score = _profile_job_score()
    safe = create_tailoring_draft(profile, job, score)
    unsafe = TailoringDraft(
        job_id=safe.job_id,
        company=safe.company,
        role=safe.role,
        summary=safe.summary + " Also highlights Git experience.",
        bullets=safe.bullets,
        evidence_ids=safe.evidence_ids,
        matched_skills=safe.matched_skills,
        gaps=safe.gaps,
    )

    result = review_draft(profile, score, unsafe)

    assert result.passed is False
    assert any(issue.label == "unsupported_claim" for issue in result.issues)


def test_cli_review_json_output() -> None:
    result = CliRunner().invoke(
        app,
        [
            "review",
            "--jobs",
            str(MOCK_JOBS),
            "--profile",
            str(MOCK_PROFILE),
            "--job-id",
            "mock-job-003",
            "--json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["review"]["status"] == "passed"
    assert payload["draft"]["approval_required"] is True


def test_export_requires_approval_phrase(tmp_path: Path) -> None:
    profile, job, score = _profile_job_score("mock-job-001")
    draft = create_tailoring_draft(profile, job, score)
    review = review_draft(profile, score, draft)

    try:
        export_artifacts(
            candidate_id=profile.candidate_id,
            score=score,
            draft=draft,
            review=review,
            approval_phrase="yes",
            out_dir=tmp_path,
        )
    except ExportGateError as exc:
        assert "APPROVE_EXPORT" in str(exc)
    else:
        raise AssertionError("export_artifacts should require exact approval phrase")

    assert list(tmp_path.iterdir()) == []


def test_cli_export_writes_artifact_and_tracker(tmp_path: Path) -> None:
    result = CliRunner().invoke(
        app,
        [
            "export",
            "--jobs",
            str(MOCK_JOBS),
            "--profile",
            str(MOCK_PROFILE),
            "--job-id",
            "mock-job-001",
            "--approve",
            APPROVAL_PHRASE,
            "--out-dir",
            str(tmp_path),
            "--json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    artifact = Path(payload["exported"]["artifact"])
    tracker = Path(payload["exported"]["tracker"])
    assert artifact.exists()
    assert tracker.exists()

    artifact_payload = json.loads(artifact.read_text(encoding="utf-8"))
    tracker_payload = yaml.safe_load(tracker.read_text(encoding="utf-8"))
    assert artifact_payload["review"]["status"] == "passed"
    assert artifact_payload["draft"]["is_final"] is False
    assert tracker_payload["applications"][0]["status"] == "exported"


def test_cli_tracker_json_output() -> None:
    result = CliRunner().invoke(
        app,
        ["tracker", "--jobs", str(MOCK_JOBS), "--profile", str(MOCK_PROFILE), "--json"],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert len(payload["applications"]) == 3
    assert payload["applications"][0]["status"] == "ready_for_approval"
