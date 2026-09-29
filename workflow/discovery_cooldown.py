"""Apply the candidate's company and role reapplication windows to new offers."""

from __future__ import annotations

from datetime import date, timedelta
import re
import unicodedata

try:
    from workflow.discovery_dedup import _text_key
except ModuleNotFoundError:
    from discovery_dedup import _text_key


GENERIC_BUCKET_WORDS = {"all", "roles", "role", "family", "bucket", "group", "team"}


def load_windows(profile: dict) -> dict[str, dict]:
    """Ignore malformed windows exactly as the former scanner did."""
    windows = profile.get("re_apply_windows") if isinstance(profile, dict) else None
    if not isinstance(windows, dict):
        return {}
    valid = {}
    for company, item in windows.items():
        if not isinstance(item, dict):
            continue
        raw = item.get("last_apply_date")
        if not isinstance(raw, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            continue
        try:
            date.fromisoformat(raw)
        except ValueError:
            continue
        days = item.get("same_role_days")
        if "same_role_days" in item and (type(days) is not int or days < 0):
            continue
        roles = item.get("applied_to")
        if "applied_to" in item and (not isinstance(roles, list) or any(not isinstance(role, str) for role in roles)):
            continue
        bucket = item.get("cross_role_bucket")
        if "cross_role_bucket" in item and not isinstance(bucket, str):
            continue
        valid[str(company)] = item
    return valid


def company_match(job_company: str, window_company: str) -> bool:
    compact = _text_key(job_company)
    other = _text_key(window_company)
    if compact and compact == other:
        return True
    with_spaces, window_spaces = _text_key(job_company, " "), _text_key(window_company, " ")
    if not with_spaces or not window_spaces:
        return False

    def bounded(haystack: str, needle: str) -> bool:
        def word(char: str) -> bool:
            return unicodedata.category(char)[0] in {"L", "M", "N"}

        start = haystack.find(needle)
        while start >= 0:
            end = start + len(needle)
            if (start == 0 or not word(haystack[start - 1])) and (end == len(haystack) or not word(haystack[end])):
                return True
            start = haystack.find(needle, start + 1)
        return False

    return bounded(with_spaces, window_spaces) or bounded(window_spaces, with_spaces)


def cooldown(offer: dict, windows: dict[str, dict], *, today: date) -> dict:
    """Return the first active company/role window, or an explicit pass."""
    company = str(offer.get("company") or "")
    title = str(offer.get("title") or "").lower()
    for window_company, window in windows.items():
        if not company_match(company, window_company):
            continue
        until = date.fromisoformat(window["last_apply_date"]) + timedelta(days=window.get("same_role_days") or 0)
        if today >= until:
            continue
        roles = window.get("applied_to")
        if isinstance(roles, list) and any(role.lower() in title for role in roles):
            return {"skip": True, "reason": f"cooldown:{window_company}:{until.isoformat()}",
                    "cooldownUntil": until.isoformat()}
        bucket = window.get("cross_role_bucket")
        if isinstance(bucket, str):
            keywords = [word for word in bucket.lower().split("_") if word and word not in GENERIC_BUCKET_WORDS]
            if any((bool(re.search(r"\bem\b", title, re.I | re.ASCII)) or "engineering manager" in title)
                   if word == "em" else word in title for word in keywords):
                return {"skip": True, "reason": f"cooldown:{window_company}:{until.isoformat()}",
                        "cooldownUntil": until.isoformat()}
    return {"skip": False}
