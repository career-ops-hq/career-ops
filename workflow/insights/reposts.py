"""Identify reposts from distinct canonical scan observations."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from pathlib import Path
import re
import sqlite3
import unicodedata

import yaml

try:
    from workflow.company_keys import normalize_company
except ModuleNotFoundError:
    from company_keys import normalize_company


def title_key(title: str) -> str:
    """Match word identity while preserving location and seniority terms."""
    folded = unicodedata.normalize("NFD", title.strip())
    folded = "".join(char for char in folded if unicodedata.category(char) != "Mn").lower()
    words = re.findall(r"[^\W_]+", folded, re.UNICODE)
    return " ".join(sorted(set(words))) if words else title.strip().lower()


def aggregator_keys(portals: Path) -> tuple[dict[str, str], bool]:
    """Keep flagged aggregator keys and their display names."""
    if not portals.is_file():
        return {}, False
    try:
        data = yaml.safe_load(portals.read_text()) or {}
    except (OSError, yaml.YAMLError):
        return {}, False
    if not isinstance(data, dict):
        return {}, False
    keys = {}
    for section in ("tracked_companies", "job_boards"):
        entries = data.get(section)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if isinstance(entry, dict) and entry.get("aggregator") is True and isinstance(entry.get("name"), str):
                name = entry["name"].strip()
                if name:
                    keys[normalize_company(name) or name.lower()] = name
    return keys, True


def _cluster(rows: list[dict], window_days: int, min_span_days: int) -> dict | None:
    first_by_url = {}
    for row in rows:
        if row["url"] not in first_by_url or row["date"] < first_by_url[row["url"]]["date"]:
            first_by_url[row["url"]] = row
    ordered = sorted(first_by_url.values(), key=lambda row: row["date"])
    if len(ordered) < 2:
        return None
    span = (ordered[-1]["date"] - ordered[0]["date"]).days
    if not min_span_days <= span <= window_days:
        return None
    return {
        "company": rows[0]["company"], "role": ordered[-1]["title"],
        "repostCount": len(ordered), "firstSeen": ordered[0]["date"].isoformat(),
        "lastSeen": ordered[-1]["date"].isoformat(), "daysSpan": span,
        "appearances": [{"url": row["url"], "date": row["date"].isoformat(), "title": row["title"]} for row in ordered],
    }


def detect_reposts(rows: list[dict], *, window_days: int = 90, min_span_days: int = 1,
                   aggregators: set[str] | None = None) -> list[dict]:
    """Port the Node window, title identity and concurrent-opening guards."""
    if window_days < 0 or min_span_days < 0:
        raise ValueError("Repost window and minimum span must be nonnegative")
    groups = defaultdict(list)
    for row in rows:
        if not all(isinstance(row.get(key), str) and row[key].strip() for key in ("url", "company", "title", "observed_on")):
            continue
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", row["observed_on"]):
            continue
        try:
            observed = date.fromisoformat(row["observed_on"])
        except ValueError:
            continue
        company = normalize_company(row["company"]) or row["company"].strip().lower()
        if aggregators and company in aggregators:
            continue
        groups[(company, title_key(row["title"]))].append({
            "url": row["url"].strip(), "company": row["company"].strip(),
            "title": row["title"].strip(), "date": observed,
        })
    clusters = []
    for group in groups.values():
        ordered = sorted(group, key=lambda row: row["date"])
        window = []
        for row in ordered:
            if window and (row["date"] - window[0]["date"]).days > window_days:
                result = _cluster(window, window_days, min_span_days)
                if result:
                    clusters.append(result)
                window = [item for item in window if (row["date"] - item["date"]).days <= window_days]
            window.append(row)
        result = _cluster(window, window_days, min_span_days)
        if result:
            clusters.append(result)
    return sorted(clusters, key=lambda item: item["lastSeen"], reverse=True)


def repost_view(db: sqlite3.Connection, portals: Path, *, window_days: int = 90,
                min_span_days: int = 1) -> dict:
    """Query retained sightings without treating a missing source as zero."""
    exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scan_observations'").fetchone()
    if not exists:
        return {"status": "source_missing", "source": "scan_observations", "clusters": None}
    rows = [dict(row) for row in db.execute("SELECT url,company,title,observed_on FROM scan_observations ORDER BY observed_on,id")]
    aggregators, configured = aggregator_keys(portals)
    clusters = detect_reposts(rows, window_days=window_days, min_span_days=min_span_days,
                              aggregators=set(aggregators))
    return {"status": "observed", "source": "scan_observations", "observations": len(rows),
            "aggregator_config_available": configured, "aggregators_skipped": len(aggregators),
            "window_days": window_days, "min_span_days": min_span_days, "clusters": clusters}
