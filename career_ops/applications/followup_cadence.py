"""Calculate the retained application follow-up cadence from canonical facts."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
import re

import yaml


DEFAULT_CADENCE = {
    "applied_first": 7,
    "applied_subsequent": 7,
    "applied_max_followups": 2,
    "responded_initial": 1,
    "responded_subsequent": 3,
    "interview_thankyou": 1,
}
PROFILE_KEYS = {
    "applied_first_days": "applied_first",
    "applied_subsequent_days": "applied_subsequent",
    "applied_max_followups": "applied_max_followups",
    "responded_initial_days": "responded_initial",
    "responded_subsequent_days": "responded_subsequent",
    "interview_thankyou_days": "interview_thankyou",
}


def calendar_day(value: str | None) -> date | None:
    """Reject impossible or non-ISO dates rather than silently shifting cadence."""
    if not isinstance(value, str) or len(value) != 10:
        return None
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return None
    return day if day.isoformat() == value else None


APPLIED_DATE = re.compile(r"\bapplied\s+~?(\d{4}-\d{2}-\d{2})(?![\w-])", re.I)
ROW_REFERENCE = re.compile(r"#\d+\b")
REQUISITION_LABEL = re.compile(
    r"\b(?:job\s*id|posting\s*id|requisition|req|jr|job|posting|ref(?:erence)?)[\s:_-]*$", re.I
)


def applied_date_from_notes(notes: str | None) -> date | None:
    """Take the first valid own submission date, excluding sibling-row citations."""
    if not isinstance(notes, str):
        return None
    for match in APPLIED_DATE.finditer(notes):
        day = calendar_day(match.group(1))
        if day and not _cross_referenced(notes, match.start()):
            return day
    return None


def _cross_referenced(notes: str, index: int) -> bool:
    window = notes[max(0, index - 120):index]
    reference_end = -1
    for match in ROW_REFERENCE.finditer(window):
        if not REQUISITION_LABEL.search(window[:match.start()]):
            reference_end = match.end()
    if reference_end == -1:
        return False
    since_reference = window[reference_end:]
    if re.search(r"[.!?]\s", since_reference):
        return False
    separators = list(re.finditer(r"[;|]", since_reference))
    return not (separators and APPLIED_DATE.search(since_reference[:separators[-1].start()]))


def cadence_config(profile: Path, *, applied_days: int | None = None) -> dict[str, int]:
    """Resolve the existing profile's nonnegative cadence overrides."""
    config = DEFAULT_CADENCE.copy()
    if profile.exists():
        try:
            loaded = yaml.safe_load(profile.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError:
            loaded = {}
        source = loaded.get("followup_cadence") if isinstance(loaded, dict) else {}
        if not isinstance(source, dict):
            source = {}
        for input_key, output_key in PROFILE_KEYS.items():
            value = source.get(input_key)
            if isinstance(value, str) and value.isdecimal():
                value = int(value)
            if type(value) is int and value >= 0:
                config[output_key] = value
    if applied_days is not None:
        if applied_days < 0:
            raise ValueError("--applied-days must be a nonnegative integer")
        config["applied_first"] = applied_days
    return config


def cadence(
    status: str,
    applied: date,
    last_followup: date | None,
    followup_count: int,
    *,
    today: date,
    config: dict[str, int],
) -> dict:
    """Match the Node urgency and next-date policy without inventing a send."""
    days_since_app = (today - applied).days
    days_since_last = (today - last_followup).days if last_followup else None
    next_day = None
    urgency = "waiting"

    if status == "applied":
        if followup_count >= config["applied_max_followups"]:
            urgency = "cold"
        elif followup_count == 0:
            next_day = applied + timedelta(days=config["applied_first"])
            if days_since_app >= config["applied_first"]:
                urgency = "overdue"
        else:
            next_day = (last_followup or applied) + timedelta(days=config["applied_subsequent"])
            if days_since_last is not None and days_since_last >= config["applied_subsequent"]:
                urgency = "overdue"
    elif status == "responded":
        if last_followup:
            next_day = last_followup + timedelta(days=config["responded_subsequent"])
            if days_since_last is not None and days_since_last >= config["responded_subsequent"]:
                urgency = "overdue"
        else:
            next_day = applied + timedelta(days=config["responded_initial"])
            if days_since_app < config["responded_initial"]:
                urgency = "urgent"
            elif days_since_app >= config["responded_subsequent"]:
                urgency = "overdue"
    elif status == "interview":
        if last_followup:
            next_day = last_followup + timedelta(days=config["responded_subsequent"])
            if days_since_last is not None and days_since_last >= config["responded_subsequent"]:
                urgency = "overdue"
        else:
            next_day = applied + timedelta(days=config["interview_thankyou"])
            if days_since_app >= config["interview_thankyou"]:
                urgency = "overdue"

    return {
        "daysSinceApplication": days_since_app,
        "daysSinceLastFollowup": days_since_last,
        "followupCount": followup_count,
        "urgency": urgency,
        "nextFollowupDate": next_day.isoformat() if next_day else None,
        "daysUntilNext": (next_day - today).days if next_day else None,
    }
