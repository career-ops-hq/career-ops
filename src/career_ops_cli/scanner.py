"""Mock-first job scanning utilities.

The public CLI does not scrape job boards or call employer systems. A scan is a
structured read of a user-provided fixture, which keeps demos deterministic and
safe to run in interviews or CI.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from career_ops_cli.io import load_yaml
from career_ops_cli.models import JobPosting

DEFAULT_JOBS_PATH = Path("examples/mock/jobs.yml")


class ScanInputError(ValueError):
    """Raised when a scan fixture is missing required structure."""


def load_jobs(path: str | Path = DEFAULT_JOBS_PATH) -> tuple[JobPosting, ...]:
    """Load job postings from a YAML scan fixture."""

    data = load_yaml(path)
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
        raise ScanInputError("Scan input must be a YAML object with a 'jobs' list.")

    return tuple(_parse_job(raw, index) for index, raw in enumerate(data["jobs"], start=1))


def filter_jobs(
    jobs: tuple[JobPosting, ...],
    *,
    query: str | None = None,
    work_mode: str | None = None,
) -> tuple[JobPosting, ...]:
    """Filter job postings by simple case-insensitive text and work-mode matches."""

    filtered = jobs
    if query:
        needle = query.casefold()
        filtered = tuple(job for job in filtered if needle in _search_text(job).casefold())
    if work_mode:
        mode = work_mode.casefold()
        filtered = tuple(job for job in filtered if job.work_mode.casefold() == mode)
    return filtered


def job_to_record(job: JobPosting) -> dict[str, Any]:
    """Convert a job posting into a JSON/YAML friendly record."""

    return {
        "job_id": job.job_id,
        "company": job.company,
        "role": job.role,
        "location": job.location,
        "work_mode": job.work_mode,
        "source": job.source,
        "required_skills": list(job.required_skills),
        "preferred_skills": list(job.preferred_skills),
        "responsibilities": list(job.responsibilities),
    }


def _parse_job(raw: Any, index: int) -> JobPosting:
    if not isinstance(raw, dict):
        raise ScanInputError(f"Job #{index} must be an object.")

    required = ("job_id", "company", "role", "location", "work_mode")
    missing = [key for key in required if not raw.get(key)]
    if missing:
        raise ScanInputError(f"Job #{index} is missing required field(s): {', '.join(missing)}.")

    return JobPosting(
        job_id=str(raw["job_id"]),
        company=str(raw["company"]),
        role=str(raw["role"]),
        location=str(raw["location"]),
        work_mode=str(raw["work_mode"]),
        required_skills=_string_tuple(raw.get("required_skills", ())),
        preferred_skills=_string_tuple(raw.get("preferred_skills", ())),
        responsibilities=_string_tuple(raw.get("responsibilities", ())),
        source=str(raw.get("source", "mock")),
    )


def _string_tuple(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list | tuple):
        raise ScanInputError("Skill and responsibility fields must be lists.")
    return tuple(str(item) for item in value)


def _search_text(job: JobPosting) -> str:
    return " ".join(
        (
            job.job_id,
            job.company,
            job.role,
            job.location,
            job.work_mode,
            " ".join(job.required_skills),
            " ".join(job.preferred_skills),
            " ".join(job.responsibilities),
        )
    )
