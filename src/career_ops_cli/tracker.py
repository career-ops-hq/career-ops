"""Tracker statuses and structured tracker helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from career_ops_cli.models import ScoreBreakdown
from career_ops_cli.safety import ReviewResult

TRACKER_STATUSES = (
    "scanned",
    "scored",
    "drafted",
    "review_blocked",
    "ready_for_approval",
    "exported",
)


def build_tracker_record(
    score: ScoreBreakdown,
    review: ReviewResult,
    *,
    exported: bool,
) -> dict[str, Any]:
    """Build a machine-readable tracker record for one job workflow."""

    if exported:
        status = "exported"
    elif review.passed:
        status = "ready_for_approval"
    else:
        status = "review_blocked"

    return {
        "job_id": score.job_id,
        "company": score.company,
        "role": score.role,
        "status": status,
        "score": score.total,
        "recommendation": score.recommendation,
        "review_status": review.status,
        "exported": exported,
        "updated_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
