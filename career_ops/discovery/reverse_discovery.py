"""Apply the reverse ATS sweep's fresh-date and matching decisions in Python."""

from __future__ import annotations

from datetime import datetime, timezone

from career_ops.discovery.dedup import _text_key, company_role_key, url_key
from career_ops.discovery.filters import content_match, location_match, title_match


def title_config(config: dict | None) -> dict | None:
    """Use the stricter reverse-scan profile when explicitly present."""
    if config is None:
        return None
    return config.get("title_filter_full") if config.get("title_filter_full") is not None else config.get("title_filter")


def date_class(job: dict, cutoff_ms: float) -> str:
    posted_at = job.get("postedAt")
    if posted_at and posted_at < cutoff_ms:
        return "stale"
    return "keep" if posted_at else "undated"


def pre_enrich(job: dict, config: dict, cutoff_ms: float) -> bool:
    """Enrich an undated provider row only after cheap title and location gates."""
    if date_class(job, cutoff_ms) != "undated":
        return False
    allowed, _ = title_match(job.get("title"), title_config(config))
    return allowed and location_match(job.get("location"), job.get("url"), job.get("title"),
                                      config.get("location_filter"))


def rejection(job: dict, config: dict, cutoff_ms: float, *, include_undated: bool = False) -> str | None:
    """Preserve the reverse scanner's date → title → location → content order."""
    if not job.get("url") or not job.get("title"):
        return "invalid"
    status = date_class(job, cutoff_ms)
    if status == "stale":
        return "stale"
    if status == "undated" and not include_undated:
        return "undated"
    allowed, matched = title_match(job["title"], title_config(config))
    if not allowed:
        return "title"
    if not location_match(job.get("location"), job.get("url"), job["title"], config.get("location_filter")):
        return "location"
    if not content_match(job.get("description"), config.get("content_filter"), matched):
        return "content"
    return None


def retain_jobs(jobs: list[dict], source: str, config: dict, cutoff_ms: float,
                seen_urls: set, seen_roles: set, *, include_undated: bool = False) -> tuple[list[dict], dict[str, int]]:
    """Filter and deduplicate one collected board against the run's shared snapshot."""
    offers, dropped = [], {"invalid": 0, "stale": 0, "undated": 0, "title": 0, "location": 0, "content": 0, "duplicate": 0}
    for job in jobs:
        reason = rejection(job, config, cutoff_ms, include_undated=include_undated)
        if reason:
            dropped[reason] += 1
            continue
        normalized_url = url_key(job["url"])
        normalized_role = company_role_key(job.get("company"), job["title"])
        if normalized_url in seen_urls or normalized_role in seen_roles:
            dropped["duplicate"] += 1
            continue
        seen_urls.add(normalized_url)
        seen_roles.add(normalized_role)
        offers.append({**job, "source": source, "dateStatus": "dated" if job.get("postedAt") else "unknown"})
    return offers, dropped


def blacklist_offers(offers: list[dict], blacklist: dict, *, include_blacklisted: bool = False) -> tuple[list[dict], int, int]:
    """Apply the user-owned do-not-apply list after board/seed deduplication."""
    retained, filtered, annotated = [], 0, 0
    for offer in offers:
        entry = blacklist.get(_text_key(offer.get("company")))
        if not entry:
            retained.append(offer)
            continue
        if not include_blacklisted:
            filtered += 1
            continue
        annotated += 1
        label = "blacklisted" + (f': {entry["reason"]}' if entry.get("reason") else "")
        note = offer.get("note")
        retained.append({**offer, "blacklisted": True,
                         "note": label + (f" — {note}" if isinstance(note, str) and note.strip() else "")})
    return retained, filtered, annotated


def output_offer(offer: dict) -> dict:
    """Format one retained row for the reverse-scan machine-readable result."""
    posted_at = offer.get("postedAt")
    posted = datetime.fromtimestamp(posted_at / 1000, timezone.utc).date().isoformat() if posted_at else None
    return {"company": offer.get("company"), "title": offer.get("title"), "url": offer.get("url"),
            "location": offer.get("location") or None, "postedAt": posted,
            "dateStatus": offer.get("dateStatus") or ("dated" if posted_at else "unknown"),
            "blacklisted": bool(offer.get("blacklisted")), "note": offer.get("note") or None,
            "source": offer.get("source")}
