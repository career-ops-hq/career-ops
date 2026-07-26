"""Export helpers and approval constants."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from career_ops_cli.io import write_json, write_yaml
from career_ops_cli.models import ScoreBreakdown
from career_ops_cli.safety import ReviewResult, review_to_record
from career_ops_cli.tailoring import TailoringDraft, draft_to_record
from career_ops_cli.tracker import build_tracker_record

APPROVAL_PHRASE = "APPROVE_EXPORT"
FINAL_ARTIFACT_WARNING = (
    "Final artifacts require human approval and must be reviewed for unsupported claims."
)


class ExportGateError(ValueError):
    """Raised when a final export is blocked by safety or approval gates."""


def export_artifacts(
    *,
    candidate_id: str,
    score: ScoreBreakdown,
    draft: TailoringDraft,
    review: ReviewResult,
    approval_phrase: str,
    out_dir: str | Path,
) -> dict[str, Path]:
    """Export final JSON artifacts only after review passes and approval is explicit."""

    if not review.passed:
        raise ExportGateError("Safety review did not pass; export is blocked.")
    if approval_phrase != APPROVAL_PHRASE:
        raise ExportGateError(f"Approval phrase must be exactly {APPROVAL_PHRASE!r}.")

    target = Path(out_dir)
    target.mkdir(parents=True, exist_ok=True)

    artifact_path = target / f"{score.job_id}-artifact.json"
    tracker_path = target / "tracker.yml"
    exported_at = datetime.now(UTC).isoformat(timespec="seconds")
    artifact: dict[str, Any] = {
        "candidate_id": candidate_id,
        "job_id": score.job_id,
        "company": score.company,
        "role": score.role,
        "exported_at": exported_at,
        "warning": FINAL_ARTIFACT_WARNING,
        "score": {
            "total": score.total,
            "recommendation": score.recommendation,
        },
        "draft": draft_to_record(draft),
        "review": review_to_record(review),
    }
    tracker = {
        "applications": [
            build_tracker_record(score, review, exported=True),
        ]
    }

    write_json(artifact_path, artifact)
    write_yaml(tracker_path, tracker)
    return {"artifact": artifact_path, "tracker": tracker_path}
