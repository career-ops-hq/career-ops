"""Candidate profile loading for synthetic or user-provided fixtures."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from career_ops_cli.io import load_yaml
from career_ops_cli.models import CandidateProfile, EvidenceItem

DEFAULT_PROFILE_PATH = Path("examples/mock/profile.yml")


class ProfileInputError(ValueError):
    """Raised when a candidate profile fixture is malformed."""


def load_profile(path: str | Path = DEFAULT_PROFILE_PATH) -> CandidateProfile:
    """Load a candidate profile from a YAML fixture."""

    data = load_yaml(path)
    candidate = data.get("candidate") if isinstance(data, dict) else None
    if not isinstance(candidate, dict):
        raise ProfileInputError("Profile input must contain a 'candidate' object.")

    required = ("candidate_id", "display_name", "target_roles", "skills")
    missing = [key for key in required if not candidate.get(key)]
    if missing:
        raise ProfileInputError(f"Candidate is missing required field(s): {', '.join(missing)}.")

    return CandidateProfile(
        candidate_id=str(candidate["candidate_id"]),
        display_name=str(candidate["display_name"]),
        target_roles=_string_tuple(candidate["target_roles"], "target_roles"),
        skills=_string_tuple(candidate["skills"], "skills"),
        evidence=_parse_evidence(candidate.get("evidence", ())),
    )


def _parse_evidence(raw_items: Any) -> tuple[EvidenceItem, ...]:
    if raw_items is None:
        return ()
    if not isinstance(raw_items, list | tuple):
        raise ProfileInputError("Candidate evidence must be a list.")

    parsed: list[EvidenceItem] = []
    for index, raw in enumerate(raw_items, start=1):
        if not isinstance(raw, dict):
            raise ProfileInputError(f"Evidence #{index} must be an object.")
        if not raw.get("evidence_id") or not raw.get("summary"):
            raise ProfileInputError(f"Evidence #{index} needs evidence_id and summary.")
        parsed.append(
            EvidenceItem(
                evidence_id=str(raw["evidence_id"]),
                summary=str(raw["summary"]),
                skills=_string_tuple(raw.get("skills", ()), f"evidence #{index} skills"),
            )
        )
    return tuple(parsed)


def _string_tuple(value: Any, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        raise ProfileInputError(f"Candidate {field_name} must be a list.")
    return tuple(str(item) for item in value)
