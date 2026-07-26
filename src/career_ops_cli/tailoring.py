"""Draft-generation boundaries for tailored application materials."""

from __future__ import annotations

from dataclasses import dataclass

from career_ops_cli.models import CandidateProfile, JobPosting, ScoreBreakdown


@dataclass(frozen=True)
class TailoringDraft:
    """A non-final draft that still requires safety review and approval."""

    job_id: str
    company: str
    role: str
    summary: str
    bullets: tuple[str, ...]
    evidence_ids: tuple[str, ...]
    matched_skills: tuple[str, ...]
    gaps: tuple[str, ...]
    approval_required: bool = True
    is_final: bool = False


def create_tailoring_draft(
    profile: CandidateProfile,
    job: JobPosting,
    score: ScoreBreakdown,
) -> TailoringDraft:
    """Create a non-final, evidence-backed draft for a scored job."""

    evidence = _evidence_for_score(profile, score)
    matched_skills = tuple(
        dict.fromkeys(score.matches["required_skills"] + score.matches["preferred_skills"])
    )
    gaps = tuple(dict.fromkeys(score.gaps["required_skills"] + score.gaps["preferred_skills"]))

    summary = _summary(profile, job, score, matched_skills, evidence)
    bullets = _bullets(matched_skills, evidence, gaps)

    return TailoringDraft(
        job_id=job.job_id,
        company=job.company,
        role=job.role,
        summary=summary,
        bullets=bullets,
        evidence_ids=tuple(item.evidence_id for item in evidence),
        matched_skills=matched_skills,
        gaps=gaps,
    )


def draft_to_record(draft: TailoringDraft) -> dict[str, object]:
    """Convert a tailoring draft into a JSON/YAML friendly record."""

    return {
        "job_id": draft.job_id,
        "company": draft.company,
        "role": draft.role,
        "is_final": draft.is_final,
        "approval_required": draft.approval_required,
        "summary": draft.summary,
        "bullets": list(draft.bullets),
        "evidence_ids": list(draft.evidence_ids),
        "matched_skills": list(draft.matched_skills),
        "gaps": list(draft.gaps),
    }


def _evidence_for_score(
    profile: CandidateProfile,
    score: ScoreBreakdown,
) -> tuple:
    evidence_by_id = {item.evidence_id: item for item in profile.evidence}
    return tuple(
        evidence_by_id[evidence_id]
        for evidence_id in score.matches["evidence_ids"]
        if evidence_id in evidence_by_id
    )


def _summary(
    profile: CandidateProfile,
    job: JobPosting,
    score: ScoreBreakdown,
    matched_skills: tuple[str, ...],
    evidence: tuple,
) -> str:
    skills_text = ", ".join(matched_skills[:4]) or "the visible requirements"
    evidence_text = "; ".join(item.summary for item in evidence[:2])
    if not evidence_text:
        evidence_text = "No direct evidence item was found, so this draft should stay conservative."

    return (
        f"Draft only: {profile.display_name} is a {score.recommendation.replace('_', ' ')} "
        f"for {job.role} at {job.company}, with support around {skills_text}. "
        f"Evidence used: {evidence_text}"
    )


def _bullets(
    matched_skills: tuple[str, ...],
    evidence: tuple,
    gaps: tuple[str, ...],
) -> tuple[str, ...]:
    bullets: list[str] = []
    for item in evidence[:3]:
        skill_overlap = [skill for skill in item.skills if skill in matched_skills]
        suffix = f" Supports: {', '.join(skill_overlap)}." if skill_overlap else ""
        bullets.append(f"Use evidence {item.evidence_id}: {item.summary}{suffix}")

    if matched_skills:
        bullets.append(f"Mirror matched language honestly: {', '.join(matched_skills)}.")
    if gaps:
        bullets.append(f"Known gaps to avoid claiming: {', '.join(gaps)}.")
    bullets.append("Human approval is required before any final artifact is exported.")
    return tuple(bullets)
