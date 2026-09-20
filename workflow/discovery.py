"""Discover configured Workday jobs and retain their immutable source evidence."""

from __future__ import annotations

import hashlib
import html
import json
import re
import sqlite3
import urllib.parse
import urllib.request
from pathlib import Path

import yaml


def request_json(url: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json", "User-Agent": "career-ops/1"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def workday_endpoint(api: str) -> tuple[str, str, str]:
    parsed = urllib.parse.urlsplit(api.rstrip("/"))
    parts = parsed.path.strip("/").split("/")
    if not parsed.hostname or not parts or not parts[-1]:
        raise ValueError(f"Invalid Workday API URL: {api}")
    site = parts[-2] if parts[-1] == "jobs" and len(parts) > 1 else parts[-1]
    return f"{parsed.scheme}://{parsed.netloc}", parsed.hostname.split(".")[0], site


def text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(value or ""))).strip()


def term_matches(value: str, term: str) -> bool:
    folded = value.casefold()
    parts = term.casefold().split(" + ")
    return all(
        re.search(rf"(?<!\w){re.escape(part)}(?!\w)", folded) is not None
        if len(part) <= 3 and part.isalnum() else part in folded
        for part in parts
    )


def matches(value: str, terms: list[str]) -> bool:
    return any(term_matches(value, term) for term in terms)


def ensure_tables(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS opportunities (
          id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, company TEXT NOT NULL,
          role TEXT NOT NULL, identity TEXT NOT NULL UNIQUE, source TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'discovered', application_state TEXT NOT NULL DEFAULT 'none',
          claimed_by TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS source_evidence (
          id INTEGER PRIMARY KEY, opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
          source TEXT NOT NULL, payload TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS page_evidence (
          opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id),
          content TEXT NOT NULL, content_hash TEXT NOT NULL,
          captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )


def retain(db: sqlite3.Connection, company: str, url: str, role: str, payload: dict) -> bool:
    identity = f"{company.casefold().strip()}::{role.casefold().strip()}"
    before = db.total_changes
    db.execute(
        "INSERT OR IGNORE INTO opportunities(url,company,role,identity,source) VALUES(?,?,?,?,?)",
        (url, company, role, identity, "workday"),
    )
    row = db.execute(
        "SELECT id FROM opportunities WHERE url=? OR identity=? ORDER BY id LIMIT 1", (url, identity)
    ).fetchone()
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if not db.execute(
        "SELECT 1 FROM source_evidence WHERE opportunity_id=? AND source='workday' AND payload=?",
        (row[0], serialized),
    ).fetchone():
        db.execute(
            "INSERT INTO source_evidence(opportunity_id,source,payload) VALUES(?,'workday',?)",
            (row[0], serialized),
        )
    description = text(payload.get("jobPostingInfo", {}).get("jobDescription", ""))
    if description:
        db.execute(
            "INSERT OR IGNORE INTO page_evidence(opportunity_id,content,content_hash) VALUES(?,?,?)",
            (row[0], description, hashlib.sha256(description.encode()).hexdigest()),
        )
    return db.total_changes > before


def discover(directory: Path, config_path: Path, fetch_json=request_json) -> dict:
    config = yaml.safe_load(config_path.read_text())
    positives = config.get("title_filter", {}).get("positive", [])
    negatives = config.get("title_filter", {}).get("negative", [])
    location = config.get("location_filter", {})
    allow = location.get("allow", [])
    block = location.get("block", [])
    always = location.get("always_allow", [])
    sources = [
        item for item in config.get("tracked_companies", [])
        if item.get("enabled", True) and item.get("provider") == "workday" and item.get("api")
    ]
    directory.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(directory / "opportunities.db")
    ensure_tables(db)
    added = 0
    checked = 0
    failures = []
    try:
        for source in sources:
            try:
                origin, tenant, site = workday_endpoint(source["api"])
                endpoint = f"{origin}/wday/cxs/{tenant}/{site}"
                for offset in range(0, 100, 20):
                    listing = fetch_json(f"{endpoint}/jobs", {"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": ""})
                    jobs = listing.get("jobPostings", [])
                    for job in jobs:
                        role = job.get("title", "")
                        place = job.get("locationsText", "")
                        if (positives and not matches(role, positives)) or matches(role, negatives):
                            continue
                        if matches(place, block) and not matches(place, always):
                            continue
                        if allow and place and not matches(place, allow):
                            continue
                        detail = fetch_json(f"{endpoint}{job['externalPath']}")
                        info = detail.get("jobPostingInfo", {})
                        detail_place = place or info.get("location", "")
                        if matches(detail_place, block) and not matches(detail_place, always):
                            continue
                        if allow and detail_place and not matches(detail_place, allow):
                            continue
                        url = info.get("externalUrl") or f"{source['api'].rstrip('/')}{job['externalPath']}"
                        added += retain(db, source["name"], url, role, detail)
                        checked += 1
                    if len(jobs) < 20:
                        break
                db.commit()
            except Exception as error:
                failures.append({"source": source["name"], "error": str(error)})
        status = "failed" if failures and not checked else "partial" if failures else "completed"
        return {"status": status, "sources": len(sources), "checked": checked, "added": added, "failures": failures}
    finally:
        db.close()
