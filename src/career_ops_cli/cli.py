"""Command-line entrypoint for the public-safe Career-Ops CLI."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from career_ops_cli import __version__
from career_ops_cli.exporter import APPROVAL_PHRASE, ExportGateError, export_artifacts
from career_ops_cli.profile import DEFAULT_PROFILE_PATH, ProfileInputError, load_profile
from career_ops_cli.safety import review_draft, review_to_record
from career_ops_cli.scanner import (
    DEFAULT_JOBS_PATH,
    ScanInputError,
    filter_jobs,
    job_to_record,
    load_jobs,
)
from career_ops_cli.scoring import score_job, score_to_record
from career_ops_cli.tailoring import create_tailoring_draft, draft_to_record
from career_ops_cli.tracker import build_tracker_record

JobsInputOption = Annotated[
    Path,
    typer.Option(
        "--jobs",
        "-j",
        exists=True,
        readable=True,
        help="YAML job fixture. Defaults to synthetic mock data.",
    ),
]
ProfileInputOption = Annotated[
    Path,
    typer.Option(
        "--profile",
        "-p",
        exists=True,
        readable=True,
        help="YAML candidate profile fixture. Defaults to synthetic mock data.",
    ),
]
JobIdOption = Annotated[str, typer.Option("--job-id", help="Job id to process.")]
JsonOutputOption = Annotated[bool, typer.Option("--json", help="Print structured JSON.")]

app = typer.Typer(
    help=(
        "Public-safe career workflow CLI for mock-first scanning, scoring, "
        "tailoring, review, and human-approved exports."
    )
)


@app.callback()
def main() -> None:
    """Career-Ops command group."""


@app.command()
def version() -> None:
    """Print the installed package version."""

    typer.echo(__version__)


@app.command()
def scan(
    input_path: Annotated[
        Path,
        typer.Option(
            "--input",
            "-i",
            exists=True,
            readable=True,
            help="YAML scan fixture to read. Defaults to synthetic mock data.",
        ),
    ] = DEFAULT_JOBS_PATH,
    query: Annotated[
        str | None,
        typer.Option(
            "--query",
            "-q",
            help="Case-insensitive text filter across role, company, skills, and responsibilities.",
        ),
    ] = None,
    work_mode: Annotated[
        str | None,
        typer.Option(
            "--work-mode",
            help="Filter by exact work mode, such as remote, hybrid, or onsite.",
        ),
    ] = None,
    json_output: JsonOutputOption = False,
) -> None:
    """Read mock job postings from a structured fixture."""

    try:
        jobs = filter_jobs(load_jobs(input_path), query=query, work_mode=work_mode)
    except ScanInputError as exc:
        raise typer.BadParameter(str(exc), param_hint="--input") from exc

    records = [job_to_record(job) for job in jobs]
    if json_output:
        typer.echo(json.dumps({"count": len(records), "jobs": records}, indent=2))
        return

    typer.echo(f"Found {len(records)} job(s) from {input_path}")
    for job in jobs:
        skills = ", ".join(job.required_skills[:3])
        if len(job.required_skills) > 3:
            skills += ", ..."
        typer.echo(
            f"{job.job_id} | {job.company} | {job.role} | "
            f"{job.work_mode} | required: {skills or 'none'}"
        )


@app.command()
def score(
    jobs_path: JobsInputOption = DEFAULT_JOBS_PATH,
    profile_path: ProfileInputOption = DEFAULT_PROFILE_PATH,
    job_id: Annotated[
        str | None,
        typer.Option("--job-id", help="Score one job id from the jobs fixture."),
    ] = None,
    json_output: JsonOutputOption = False,
) -> None:
    """Score mock jobs against a structured candidate profile."""

    try:
        profile = load_profile(profile_path)
        jobs = load_jobs(jobs_path)
    except (ProfileInputError, ScanInputError) as exc:
        raise typer.BadParameter(str(exc)) from exc

    if job_id:
        jobs = tuple(job for job in jobs if job.job_id == job_id)
        if not jobs:
            raise typer.BadParameter(f"No job found for --job-id {job_id!r}.", param_hint="--job-id")

    scores = [score_job(profile, job) for job in jobs]
    records = [score_to_record(item) for item in scores]
    if json_output:
        typer.echo(
            json.dumps(
                {
                    "candidate_id": profile.candidate_id,
                    "count": len(records),
                    "scores": records,
                },
                indent=2,
            )
        )
        return

    typer.echo(f"Scored {len(scores)} job(s) for {profile.display_name}")
    for item in scores:
        required_gaps = ", ".join(item.gaps["required_skills"]) or "none"
        typer.echo(
            f"{item.job_id} | {item.company} | {item.role} | "
            f"{item.total:.1f}/100 | {item.recommendation} | required gaps: {required_gaps}"
        )


@app.command()
def tailor(
    jobs_path: JobsInputOption = DEFAULT_JOBS_PATH,
    profile_path: ProfileInputOption = DEFAULT_PROFILE_PATH,
    job_id: Annotated[
        str,
        typer.Option("--job-id", help="Job id to tailor. Tailoring is intentionally one job at a time."),
    ] = ...,
    json_output: JsonOutputOption = False,
) -> None:
    """Generate a non-final, evidence-backed tailoring draft."""

    try:
        profile = load_profile(profile_path)
        jobs = load_jobs(jobs_path)
    except (ProfileInputError, ScanInputError) as exc:
        raise typer.BadParameter(str(exc)) from exc

    matches = tuple(job for job in jobs if job.job_id == job_id)
    if not matches:
        raise typer.BadParameter(f"No job found for --job-id {job_id!r}.", param_hint="--job-id")

    job = matches[0]
    score = score_job(profile, job)
    draft = create_tailoring_draft(profile, job, score)
    record = draft_to_record(draft)

    if json_output:
        typer.echo(json.dumps({"draft": record}, indent=2))
        return

    typer.echo(f"Draft for {draft.company} - {draft.role}")
    typer.echo(f"Final: {draft.is_final}; approval required: {draft.approval_required}")
    typer.echo(draft.summary)
    for bullet in draft.bullets:
        typer.echo(f"- {bullet}")


@app.command()
def review(
    jobs_path: JobsInputOption = DEFAULT_JOBS_PATH,
    profile_path: ProfileInputOption = DEFAULT_PROFILE_PATH,
    job_id: JobIdOption = ...,
    json_output: JsonOutputOption = False,
) -> None:
    """Run a no-invention safety review on a generated draft."""

    profile, job = _load_profile_and_job(profile_path, jobs_path, job_id)
    score_result = score_job(profile, job)
    draft = create_tailoring_draft(profile, job, score_result)
    review_result = review_draft(profile, score_result, draft)

    if json_output:
        typer.echo(
            json.dumps(
                {
                    "job_id": job.job_id,
                    "draft": draft_to_record(draft),
                    "review": review_to_record(review_result),
                },
                indent=2,
            )
        )
        return

    typer.echo(f"Review for {job.company} - {job.role}: {review_result.status}")
    if review_result.issues:
        for issue in review_result.issues:
            typer.echo(f"- {issue.severity}: {issue.label} - {issue.message}")
    else:
        typer.echo("No unsupported claims or blocked actions found.")


@app.command()
def tracker(
    jobs_path: JobsInputOption = DEFAULT_JOBS_PATH,
    profile_path: ProfileInputOption = DEFAULT_PROFILE_PATH,
    json_output: JsonOutputOption = False,
) -> None:
    """Build a structured tracker preview from mock scan/score/review data."""

    try:
        profile = load_profile(profile_path)
        jobs = load_jobs(jobs_path)
    except (ProfileInputError, ScanInputError) as exc:
        raise typer.BadParameter(str(exc)) from exc

    records = []
    for job in jobs:
        score_result = score_job(profile, job)
        draft = create_tailoring_draft(profile, job, score_result)
        review_result = review_draft(profile, score_result, draft)
        records.append(build_tracker_record(score_result, review_result, exported=False))

    if json_output:
        typer.echo(json.dumps({"applications": records}, indent=2))
        return

    typer.echo(f"Tracker preview: {len(records)} application(s)")
    for item in records:
        typer.echo(
            f"{item['job_id']} | {item['company']} | {item['status']} | "
            f"{item['score']:.1f}/100 | {item['recommendation']}"
        )


@app.command()
def export(
    jobs_path: JobsInputOption = DEFAULT_JOBS_PATH,
    profile_path: ProfileInputOption = DEFAULT_PROFILE_PATH,
    job_id: JobIdOption = ...,
    approve: Annotated[
        str,
        typer.Option("--approve", help=f"Required exact approval phrase: {APPROVAL_PHRASE}"),
    ] = "",
    out_dir: Annotated[
        Path,
        typer.Option("--out-dir", help="Directory for exported files."),
    ] = Path("exports"),
    json_output: JsonOutputOption = False,
) -> None:
    """Export final JSON artifacts only after review and explicit approval."""

    profile, job = _load_profile_and_job(profile_path, jobs_path, job_id)
    score_result = score_job(profile, job)
    draft = create_tailoring_draft(profile, job, score_result)
    review_result = review_draft(profile, score_result, draft)

    try:
        paths = export_artifacts(
            candidate_id=profile.candidate_id,
            score=score_result,
            draft=draft,
            review=review_result,
            approval_phrase=approve,
            out_dir=out_dir,
        )
    except ExportGateError as exc:
        raise typer.BadParameter(str(exc), param_hint="--approve") from exc

    payload = {key: str(path) for key, path in paths.items()}
    if json_output:
        typer.echo(json.dumps({"exported": payload}, indent=2))
        return

    typer.echo("Export complete.")
    typer.echo(f"Artifact: {paths['artifact']}")
    typer.echo(f"Tracker: {paths['tracker']}")


def _load_profile_and_job(
    profile_path: Path,
    jobs_path: Path,
    job_id: str,
):
    try:
        profile = load_profile(profile_path)
        jobs = load_jobs(jobs_path)
    except (ProfileInputError, ScanInputError) as exc:
        raise typer.BadParameter(str(exc)) from exc

    matches = tuple(job for job in jobs if job.job_id == job_id)
    if not matches:
        raise typer.BadParameter(f"No job found for --job-id {job_id!r}.", param_hint="--job-id")
    return profile, matches[0]


if __name__ == "__main__":
    app()
