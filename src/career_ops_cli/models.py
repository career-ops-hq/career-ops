"""Typed data shapes used by the Career-Ops CLI."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class EvidenceItem:
    """A candidate claim backed by a concrete source in the profile fixture."""

    evidence_id: str
    summary: str
    skills: tuple[str, ...] = ()


@dataclass(frozen=True)
class CandidateProfile:
    """Synthetic or user-provided profile used for scoring and tailoring."""

    candidate_id: str
    display_name: str
    target_roles: tuple[str, ...]
    skills: tuple[str, ...]
    evidence: tuple[EvidenceItem, ...] = ()


@dataclass(frozen=True)
class JobPosting:
    """Structured job posting input from a scan fixture."""

    job_id: str
    company: str
    role: str
    location: str
    work_mode: str
    required_skills: tuple[str, ...] = ()
    preferred_skills: tuple[str, ...] = ()
    responsibilities: tuple[str, ...] = ()
    source: str = "mock"


@dataclass(frozen=True)
class ScoreDimension:
    """One explainable dimension in the scoring rubric."""

    name: str
    raw_score: float
    weight: float
    weighted_score: float
    reason: str


@dataclass(frozen=True)
class ScoreBreakdown:
    """Scoring result for a job/profile pair."""

    job_id: str
    company: str
    role: str
    total: float
    recommendation: str
    dimensions: tuple[ScoreDimension, ...] = ()
    matches: dict[str, tuple[str, ...]] = field(default_factory=dict)
    gaps: dict[str, tuple[str, ...]] = field(default_factory=dict)
    notes: tuple[str, ...] = ()
