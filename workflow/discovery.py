"""Invoke the existing provider scanner and read its canonical SQLite run result."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def capture_jd(directory: Path, url: str) -> dict | None:
    """Refresh one discovered posting with the existing guarded browser reader."""
    try:
        result = subprocess.run(
            ["node", str(ROOT / "lib" / "scan-jd.mjs"), url, str(directory)],
            cwd=ROOT, text=True, capture_output=True, timeout=45,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode:
        return None
    try:
        snapshot = json.loads(result.stdout).get("snapshot")
    except (AttributeError, json.JSONDecodeError):
        return None
    if not isinstance(snapshot, dict) or snapshot.get("status") != "captured":
        return None
    if any(not isinstance(snapshot.get(key), str) or not snapshot[key].strip()
           for key in ("text", "url", "retrieved_at")):
        return None
    return snapshot


def discover(directory: Path, config_path: Path, company_filter: str | None = None) -> dict:
    directory.mkdir(parents=True, exist_ok=True)
    database = directory / "opportunities.db"
    command = ["node", str(ROOT / "scan.mjs"), "configured", "--quiet"]
    if company_filter:
        command.extend(("--company", company_filter))
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            env={
                **os.environ,
                "CAREER_OPS_OPPORTUNITY_DB": str(database),
                "CAREER_OPS_PORTALS": str(config_path),
                "CAREER_OPS_PROFILE": str(config_path.parent / "config" / "profile.yml"),
                "CAREER_OPS_PRESCREEN_CACHE": str(directory / "prescreen-cache"),
            },
            text=True,
            capture_output=True,
            timeout=900,
        )
    except subprocess.TimeoutExpired:
        return {"status": "failed", "error": "Provider scanner exceeded its 900-second budget"}
    except OSError as error:
        return {"status": "failed", "error": f"Provider scanner unavailable: {error}"}
    if result.returncode:
        return {"status": "failed", "error": (result.stderr or result.stdout).strip()[-4000:]}
    with sqlite3.connect(database) as connection:
        row = connection.execute(
            "SELECT summary FROM scan_runs WHERE operation='configured' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    if row is None:
        return {"status": "failed", "error": "Provider scanner produced no persisted run"}
    summary = json.loads(row[0])
    errors = summary["errors"]
    handoff = summary.get("handoff", 0)
    sources = summary["companies"] + summary["boards"]
    incomplete = bool(errors or handoff or company_filter and not sources)
    return {
        "status": "partial" if incomplete and summary["found"] else "failed" if incomplete else "completed",
        "sources": sources,
        "checked": summary["found"],
        "added": summary["newAdded"],
        "errors": errors,
        "handoff": handoff,
        "failures": summary.get("failures", []),
        "handoff_sources": summary.get("handoff_sources", []),
    }
