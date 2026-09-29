"""Classify current scored opportunities into evidence-aware next actions."""

from __future__ import annotations

import math
from datetime import date


ORDER = {"apply": 0, "verify": 1, "deprioritize": 2, "discard": 3}


def classify(score: dict, prescreen: dict, acceptable_line: float) -> str:
    """Apply the current action policy without treating unknown gates as passes."""
    if isinstance(acceptable_line, bool) or not isinstance(acceptable_line, (int, float)) or not math.isfinite(acceptable_line) or not 1 <= acceptable_line <= 5:
        raise ValueError("acceptable_line must be between 1 and 5")
    lower, upper, coverage = (score.get(key) for key in ("lower", "upper", "coverage"))
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
           for value in (lower, upper, coverage)) or not (1 <= lower <= upper <= 5 and 0 <= coverage <= 1):
        raise ValueError("invalid attractiveness range")
    if not isinstance(prescreen, dict) or prescreen.get("status") not in {"pass", "fail", "uncertain"}:
        raise ValueError("complete prescreen decision required")
    if prescreen["status"] == "fail":
        return "discard"
    if upper < acceptable_line:
        return "deprioritize"
    if prescreen["status"] == "uncertain" or lower < acceptable_line:
        return "verify"
    return "apply"


def order(rows: list[dict]) -> list[dict]:
    """Order actions by deadline, effort, coverage and the apply lower bound."""
    ids = set()
    for row in rows:
        opportunity_id = row.get("opportunity_id")
        if not isinstance(opportunity_id, str) or not opportunity_id or opportunity_id in ids:
            raise ValueError("unique opportunity IDs required")
        ids.add(opportunity_id)
        if row.get("action") not in ORDER:
            raise ValueError("valid action required")
        deadline = row.get("deadline")
        if deadline is not None:
            try:
                if not isinstance(deadline, str) or date.fromisoformat(deadline).isoformat() != deadline:
                    raise ValueError
            except ValueError as error:
                raise ValueError("deadline must be ISO date or null") from error
        effort = row.get("effort_days")
        if effort is not None and (isinstance(effort, bool) or not isinstance(effort, (int, float))
                                   or not math.isfinite(effort) or effort < 0):
            raise ValueError("effort_days must be nonnegative or null")
    return sorted(rows, key=lambda row: (
        ORDER[row["action"]], row.get("deadline") or "9999-12-31",
        row.get("effort_days") if row.get("effort_days") is not None else math.inf,
        -row["coverage"], -row["lower"] if row["action"] == "apply" else 0,
        row["opportunity_id"],
    ))
