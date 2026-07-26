from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from career_ops_cli.cli import app
from career_ops_cli.scanner import filter_jobs, load_jobs

MOCK_JOBS = Path("examples/mock/jobs.yml")


def test_load_jobs_from_mock_fixture() -> None:
    jobs = load_jobs(MOCK_JOBS)

    assert len(jobs) == 3
    assert jobs[0].job_id == "mock-job-001"
    assert jobs[0].company == "Northstar Widgets"
    assert "Python" in jobs[0].required_skills


def test_filter_jobs_by_query_and_work_mode() -> None:
    jobs = load_jobs(MOCK_JOBS)

    filtered = filter_jobs(jobs, query="workflow", work_mode="remote")

    assert [job.job_id for job in filtered] == ["mock-job-001"]


def test_cli_scan_lists_mock_jobs() -> None:
    result = CliRunner().invoke(app, ["scan", "--input", str(MOCK_JOBS)])

    assert result.exit_code == 0
    assert "Found 3 job(s)" in result.output
    assert "Northstar Widgets" in result.output
    assert "Riverbend Analytics" in result.output


def test_cli_scan_json_filter() -> None:
    result = CliRunner().invoke(
        app,
        ["scan", "--input", str(MOCK_JOBS), "--work-mode", "remote", "--json"],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["count"] == 1
    assert payload["jobs"][0]["job_id"] == "mock-job-001"
    assert payload["jobs"][0]["source"].startswith("https://jobs.example.com/")


def test_cli_scan_rejects_invalid_fixture(tmp_path: Path) -> None:
    invalid = tmp_path / "invalid.yml"
    invalid.write_text("not_jobs: []\n", encoding="utf-8")

    result = CliRunner().invoke(app, ["scan", "--input", str(invalid)])

    assert result.exit_code != 0
    assert "jobs" in result.output
