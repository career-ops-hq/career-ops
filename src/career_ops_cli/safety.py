"""Safety primitives for no-invention review and human-in-the-loop exports."""

from __future__ import annotations

from dataclasses import dataclass

from career_ops_cli.models import CandidateProfile, ScoreBreakdown
from career_ops_cli.tailoring import TailoringDraft

BLOCKED_ACTIONS = (
    "submit_application",
    "send_email",
    "auto_apply",
)

UNSUPPORTED_CLAIM_LABEL = "unsupported_claim"

BLOCKED_TEXT_PATTERNS = (
    "submit application",
    "send email",
    "auto apply",
    "auto-apply",
)


@dataclass(frozen=True)
class ReviewIssue:
    """One safety issue found in a generated draft."""

    label: str
    severity: str
    message: str


@dataclass(frozen=True)
class ReviewResult:
    """No-invention and human-approval review result."""

    status: str
    issues: tuple[ReviewIssue, ...]

    @property
    def passed(self) -> bool:
        """Whether the draft can move to the approval/export gate."""

        return self.status == "passed"


def review_draft(
    profile: CandidateProfile,
    score: ScoreBreakdown,
    draft: TailoringDraft,
) -> ReviewResult:
    """Review a tailoring draft for unsupported claims and unsafe actions."""

    issues: list[ReviewIssue] = []
    profile_evidence_ids = {item.evidence_id for item in profile.evidence}
    score_evidence_ids = set(score.matches["evidence_ids"])
    score_matched_skills = set(score.matches["required_skills"] + score.matches["preferred_skills"])
    score_gaps = set(score.gaps["required_skills"] + score.gaps["preferred_skills"])

    if draft.is_final:
        issues.append(
            ReviewIssue(
                label="final_artifact_without_export",
                severity="blocker",
                message="Tailoring output must remain draft-only until the export approval gate.",
            )
        )

    if not draft.approval_required:
        issues.append(
            ReviewIssue(
                label="missing_approval_gate",
                severity="blocker",
                message="Draft must require human approval before export.",
            )
        )

    unknown_evidence = sorted(set(draft.evidence_ids) - profile_evidence_ids)
    if unknown_evidence:
        issues.append(
            ReviewIssue(
                label=UNSUPPORTED_CLAIM_LABEL,
                severity="blocker",
                message=f"Draft references unknown evidence id(s): {', '.join(unknown_evidence)}.",
            )
        )

    unsupported_evidence = sorted(set(draft.evidence_ids) - score_evidence_ids)
    if unsupported_evidence:
        issues.append(
            ReviewIssue(
                label=UNSUPPORTED_CLAIM_LABEL,
                severity="blocker",
                message=(
                    "Draft references evidence that did not support the scored job fit: "
                    f"{', '.join(unsupported_evidence)}."
                ),
            )
        )

    unsupported_skills = sorted(set(draft.matched_skills) - score_matched_skills)
    if unsupported_skills:
        issues.append(
            ReviewIssue(
                label=UNSUPPORTED_CLAIM_LABEL,
                severity="blocker",
                message=f"Draft claims unmatched skill(s): {', '.join(unsupported_skills)}.",
            )
        )

    missing_gap_labels = sorted(score_gaps - set(draft.gaps))
    if missing_gap_labels:
        issues.append(
            ReviewIssue(
                label="hidden_gap",
                severity="warning",
                message=f"Draft does not label known gap(s): {', '.join(missing_gap_labels)}.",
            )
        )

    text = _draft_text(draft)
    for pattern in BLOCKED_TEXT_PATTERNS:
        if pattern in text:
            issues.append(
                ReviewIssue(
                    label="blocked_action",
                    severity="blocker",
                    message=f"Draft contains blocked action phrase: {pattern}.",
                )
            )

    for gap in score_gaps:
        if _gap_is_claimed(gap, draft):
            issues.append(
                ReviewIssue(
                    label=UNSUPPORTED_CLAIM_LABEL,
                    severity="blocker",
                    message=f"Draft appears to claim known gap instead of labeling it: {gap}.",
                )
            )

    status = "blocked" if any(issue.severity == "blocker" for issue in issues) else "passed"
    return ReviewResult(status=status, issues=tuple(issues))


def review_to_record(result: ReviewResult) -> dict[str, object]:
    """Convert review result into a JSON/YAML friendly record."""

    return {
        "status": result.status,
        "passed": result.passed,
        "issues": [
            {
                "label": issue.label,
                "severity": issue.severity,
                "message": issue.message,
            }
            for issue in result.issues
        ],
    }


def _draft_text(draft: TailoringDraft) -> str:
    return " ".join((draft.summary, *draft.bullets)).casefold()


def _gap_is_claimed(gap: str, draft: TailoringDraft) -> bool:
    needle = gap.casefold()
    for text in (draft.summary, *draft.bullets):
        lowered = text.casefold()
        if needle in lowered and not lowered.startswith("known gaps"):
            return True
    return False
