"""Describe the persisted long-task execution state."""

from __future__ import annotations

from typing import Literal, TypedDict


class WorkflowState(TypedDict):
    task_id: str
    module: Literal["scan", "score", "apply"]
    input_hash: str
    outcome: Literal["jd_report", "score", "exclude", "package"]
    draft: str
    waiting_reason: str | None
    material_hash: str
    tool_calls: int
    has_prior_package: bool
