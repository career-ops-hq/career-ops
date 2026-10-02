"""Adapt the shared preparation plan to the interview domain's keyword contract."""
from __future__ import annotations

from workflow.insights.preparation import (
    build_preparation_plan as build_plan,
    parse_report_classifications as report_classifications,
    validate_preparation_plan as validate_plan,
)


def build_preparation_plan(
    *, company: str, role: str, jd_text: str, cv_text: str, profile_text: str = "", report_text: str = "",
    sources: dict | None = None, generated_at: str | None = None,
) -> dict:
    return build_plan(company, role, jd_text, cv_text, profile_text, report_text,
                      sources=sources, generated_at=generated_at)


def validate_preparation_plan(plan: dict) -> bool:
    return validate_plan(plan)["valid"]
