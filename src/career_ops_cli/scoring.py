"""Scoring rubric definitions for job-fit evaluation."""

from __future__ import annotations

import re
from collections.abc import Iterable

from career_ops_cli.models import CandidateProfile, JobPosting, ScoreBreakdown, ScoreDimension

RUBRIC_DIMENSIONS = {
    "role_alignment": 0.25,
    "required_skill_match": 0.30,
    "preferred_skill_match": 0.15,
    "evidence_strength": 0.20,
    "constraints_fit": 0.10,
}

SKILL_ALIASES = {
    "ci": ("github actions",),
    "cli design": ("typer", "command-line ux"),
    "command-line ux": ("typer", "cli design"),
    "testing": ("pytest",),
    "automation": ("workflow automation",),
    "markdown": ("documentation",),
}

STOPWORDS = {
    "a",
    "an",
    "and",
    "for",
    "intern",
    "junior",
    "student",
    "the",
    "working",
}


def validate_rubric_weights() -> bool:
    """Return True when rubric weights sum to 1.0 within normal float tolerance."""

    return abs(sum(RUBRIC_DIMENSIONS.values()) - 1.0) < 0.0001


def score_job(profile: CandidateProfile, job: JobPosting) -> ScoreBreakdown:
    """Score a job/profile fit with an explainable deterministic rubric."""

    required_matches, required_gaps = _match_skills(job.required_skills, _skill_universe(profile))
    preferred_matches, preferred_gaps = _match_skills(job.preferred_skills, _skill_universe(profile))
    evidence_ids, evidence_skill_matches = _matching_evidence(profile, job)

    dimension_scores = {
        "role_alignment": (
            _role_alignment(profile, job),
            "Best token overlap between job title and target roles.",
        ),
        "required_skill_match": (
            _ratio_score(len(required_matches), len(job.required_skills)),
            f"{len(required_matches)}/{len(job.required_skills)} required skills matched.",
        ),
        "preferred_skill_match": (
            _ratio_score(len(preferred_matches), len(job.preferred_skills)),
            f"{len(preferred_matches)}/{len(job.preferred_skills)} preferred skills matched.",
        ),
        "evidence_strength": (
            _ratio_score(len(evidence_skill_matches), len(set(job.required_skills + job.preferred_skills))),
            f"{len(evidence_ids)} evidence item(s) support matched job skills.",
        ),
        "constraints_fit": (
            _constraints_fit(job),
            "Posting does not ask the tool to submit applications or send email.",
        ),
    }

    dimensions = tuple(
        ScoreDimension(
            name=name,
            raw_score=round(raw_score, 1),
            weight=weight,
            weighted_score=round(raw_score * weight, 1),
            reason=reason,
        )
        for name, weight in RUBRIC_DIMENSIONS.items()
        for raw_score, reason in (dimension_scores[name],)
    )
    total = round(sum(item.weighted_score for item in dimensions), 1)

    notes = []
    if required_gaps:
        notes.append(f"Missing required skills: {', '.join(required_gaps)}.")
    if not evidence_ids:
        notes.append("No profile evidence directly supports the matched job skills.")

    return ScoreBreakdown(
        job_id=job.job_id,
        company=job.company,
        role=job.role,
        total=total,
        recommendation=_recommendation(total),
        dimensions=dimensions,
        matches={
            "required_skills": required_matches,
            "preferred_skills": preferred_matches,
            "evidence_ids": evidence_ids,
        },
        gaps={
            "required_skills": required_gaps,
            "preferred_skills": preferred_gaps,
        },
        notes=tuple(notes),
    )


def score_to_record(score: ScoreBreakdown) -> dict[str, object]:
    """Convert a score breakdown into a JSON/YAML friendly record."""

    return {
        "job_id": score.job_id,
        "company": score.company,
        "role": score.role,
        "score": score.total,
        "recommendation": score.recommendation,
        "dimensions": [
            {
                "name": item.name,
                "raw_score": item.raw_score,
                "weight": item.weight,
                "weighted_score": item.weighted_score,
                "reason": item.reason,
            }
            for item in score.dimensions
        ],
        "matches": {key: list(value) for key, value in score.matches.items()},
        "gaps": {key: list(value) for key, value in score.gaps.items()},
        "notes": list(score.notes),
    }


def _skill_universe(profile: CandidateProfile) -> tuple[str, ...]:
    skills = list(profile.skills)
    for evidence in profile.evidence:
        skills.extend(evidence.skills)
    return tuple(skills)


def _match_skills(required: Iterable[str], available: Iterable[str]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    matches: list[str] = []
    gaps: list[str] = []
    available_normalized = tuple(_normalize_skill(skill) for skill in available)
    for skill in required:
        if _skill_is_covered(skill, available_normalized):
            matches.append(skill)
        else:
            gaps.append(skill)
    return tuple(matches), tuple(gaps)


def _skill_is_covered(skill: str, available_normalized: tuple[str, ...]) -> bool:
    normalized = _normalize_skill(skill)
    accepted = (normalized, *SKILL_ALIASES.get(normalized, ()))
    return any(candidate in available_normalized for candidate in accepted)


def _matching_evidence(
    profile: CandidateProfile,
    job: JobPosting,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    job_skills = tuple(job.required_skills + job.preferred_skills)
    evidence_ids: list[str] = []
    evidence_matches: list[str] = []

    for evidence in profile.evidence:
        matched, _ = _match_skills(job_skills, evidence.skills)
        if matched:
            evidence_ids.append(evidence.evidence_id)
            evidence_matches.extend(matched)

    return tuple(dict.fromkeys(evidence_ids)), tuple(dict.fromkeys(evidence_matches))


def _role_alignment(profile: CandidateProfile, job: JobPosting) -> float:
    job_tokens = _role_tokens(job.role)
    if not job_tokens:
        return 0.0

    best = 0.0
    for target_role in profile.target_roles:
        target_tokens = _role_tokens(target_role)
        if not target_tokens:
            continue
        overlap = len(job_tokens & target_tokens)
        best = max(best, overlap / len(target_tokens), overlap / len(job_tokens))
    return round(best * 100, 1)


def _role_tokens(value: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", value.casefold()) if token not in STOPWORDS}


def _constraints_fit(job: JobPosting) -> float:
    blocked_terms = ("submit application", "send email", "auto apply", "auto-apply")
    haystack = " ".join((job.role, *job.responsibilities)).casefold()
    return 0.0 if any(term in haystack for term in blocked_terms) else 100.0


def _ratio_score(matches: int, total: int) -> float:
    if total == 0:
        return 100.0
    return round((matches / total) * 100, 1)


def _recommendation(total: float) -> str:
    if total >= 85:
        return "strong_match"
    if total >= 70:
        return "good_match"
    if total >= 55:
        return "stretch"
    return "not_recommended"


def _normalize_skill(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().casefold())
