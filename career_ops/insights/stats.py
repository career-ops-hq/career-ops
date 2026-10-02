"""Summarize canonical opportunity, application, scan and follow-up facts."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
import json
from pathlib import Path
import re
import sqlite3

import yaml

from career_ops.applications.followup_cadence import cadence_config


APPLICATION_STATUSES = ("applied", "responded", "interview", "offer", "hired", "rejected", "discarded")
ACTIVE = {"applied", "responded", "interview", "offer"}
ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def _table(db: sqlite3.Connection, name: str) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def _percent(part: int, total: int) -> float | None:
    return round(part * 100 / total, 1) if total else None


def _tracker(db: sqlite3.Connection) -> dict | None:
    if not _table(db, "opportunities") or not _table(db, "application_lifecycle"):
        return None
    opportunities = db.execute("SELECT COUNT(*) FROM opportunities").fetchone()[0]
    counts = dict.fromkeys(APPLICATION_STATUSES, 0)
    counts.update({row["status"]: row["count"] for row in db.execute(
        "SELECT status,COUNT(*) AS count FROM application_lifecycle GROUP BY status"
    )})
    application_count = sum(counts.values())
    excluded = 0
    unknown = 0
    reviews = 0
    failures = 0
    if _table(db, "results"):
        outcomes = db.execute("""SELECT r.opportunity_id,r.outcome FROM (
            SELECT opportunity_id,json_extract(payload,'$.outcome') AS outcome,
                   ROW_NUMBER() OVER (PARTITION BY opportunity_id ORDER BY rowid DESC) AS rank
            FROM results WHERE module IN ('scan','score')) r WHERE r.rank=1""").fetchall()
        excluded = len({row["opportunity_id"] for row in outcomes if row["outcome"] == "exclude"})
    if _table(db, "tasks"):
        waiting = {str(row["opportunity_id"]): row["waiting_reason"] for row in db.execute(
            "SELECT opportunity_id,waiting_reason FROM tasks WHERE status='waiting' ORDER BY rowid"
        )}
        unknown = sum(reason in {"source_access_unknown", "core_evidence_missing", "jd_changed", "input_changed"}
                      for reason in waiting.values())
        reviews = sum(reason == "user_review" for reason in waiting.values())
        failures = sum(reason and (reason.startswith("failure:") or reason == "workflow_version_incompatible")
                       for reason in waiting.values())
    by_state = {row["state"]: row["count"] for row in db.execute(
        "SELECT state,COUNT(*) AS count FROM opportunities GROUP BY state"
    )}
    return {"opportunities": opportunities, "applications": application_count,
            "by_application_status": counts, "by_opportunity_state": by_state,
            "active_applications": sum(counts[status] for status in ACTIVE),
            "last_retained_exclusions": excluded, "waiting_for_evidence": unknown,
            "waiting_for_review": reviews, "waiting_after_failure": failures,
            "definition": "Stored lifecycle state and latest retained result; last active JD evidence is historical, not a live posting check."}


def _funnel(db: sqlite3.Connection) -> dict | None:
    if not _table(db, "application_events"):
        return None
    reached = defaultdict(set)
    for row in db.execute("SELECT opportunity_id,to_status FROM application_events"):
        reached[row["to_status"]].add(str(row["opportunity_id"]))
    applied = set().union(*(reached[status] for status in APPLICATION_STATUSES))
    responded = set().union(*(reached[status] for status in ("responded", "interview", "offer", "hired")))
    interviewed = set().union(*(reached[status] for status in ("interview", "offer", "hired")))
    offered = reached["offer"] | reached["hired"]
    return {"ever_applied": len(applied), "ever_responded": len(responded),
            "ever_interviewed": len(interviewed), "ever_offered": len(offered),
            "response_rate_pct": _percent(len(responded), len(applied)),
            "interview_rate_pct": _percent(len(interviewed), len(applied)),
            "offer_rate_pct": _percent(len(offered), len(applied)),
            "small_sample": len(applied) < 10,
            "source": "application_events; recorded stages only"}


def _liveness(db: sqlite3.Connection) -> dict | None:
    """Separate capture-time liveness from present-day availability."""
    if not _table(db, "opportunities") or not _table(db, "results"):
        return None
    latest = {}
    for row in db.execute("SELECT opportunity_id,payload FROM results WHERE module='scan' ORDER BY rowid DESC"):
        latest.setdefault(str(row["opportunity_id"]), json.loads(row["payload"]))
    counts = {"active_at_capture": 0, "expired_at_capture": 0, "excluded_by_gate": 0,
              "excluded_unknown_cause": 0, "no_scan_result": 0}
    for row in db.execute("SELECT id FROM opportunities"):
        result = latest.get(str(row["id"]))
        if result is None:
            counts["no_scan_result"] += 1
        elif result.get("outcome") == "jd_report" and result.get("artifact", {}).get("liveness") == "active":
            counts["active_at_capture"] += 1
        elif result.get("outcome") == "exclude":
            reason = result.get("artifact", {}).get("reason_code")
            counts["expired_at_capture" if reason == "expired" else
                   "excluded_by_gate" if reason == "prescreen_failed" else "excluded_unknown_cause"] += 1
        else:
            counts["no_scan_result"] += 1
    return {**counts, "source": "latest retained scan result per opportunity",
            "definition": "Historical capture outcome; active_at_capture never asserts the posting is live today."}


def _artifact_coverage(db: sqlite3.Connection) -> dict | None:
    if not _table(db, "opportunities") or not _table(db, "results"):
        return None
    total = db.execute("SELECT COUNT(*) FROM opportunities").fetchone()[0]
    latest = {}
    for row in db.execute("SELECT opportunity_id,module,payload FROM results WHERE module IN ('score','apply') ORDER BY rowid DESC"):
        latest.setdefault((str(row["opportunity_id"]), row["module"]), json.loads(row["payload"]))
    reports = {key for (key, module), result in latest.items() if module == "score"
               and result.get("outcome") == "score" and result.get("artifact", {}).get("report_sha256")}
    pdfs = {key for (key, module), result in latest.items() if module == "apply"
            and result.get("outcome") == "package"
            and result.get("artifact", {}).get("files", {}).get("resume_pdf")}
    if _table(db, "artifacts"):
        for row in db.execute("SELECT opportunity_id,kind FROM artifacts"):
            if row["kind"] == "report":
                reports.add(str(row["opportunity_id"]))
            elif row["kind"] == "verified-application-pdf":
                pdfs.add(str(row["opportunity_id"]))
    return {"score_reports": len(reports), "resume_pdfs": len(pdfs),
            "report_pct_of_opportunities": _percent(len(reports), total),
            "pdf_pct_of_opportunities": _percent(len(pdfs), total),
            "denominator": total, "source": "latest retained score/apply results and canonical artifacts"}


def _scan(db: sqlite3.Connection, *, weeks: int = 8) -> dict | None:
    if not _table(db, "scan_observations") or not _table(db, "opportunities"):
        return None
    observations = [dict(row) for row in db.execute("""SELECT s.company,s.observed_on,o.source
        FROM scan_observations s JOIN opportunities o ON o.id=s.opportunity_id""")]
    days = []
    weeks_count = Counter()
    for row in observations:
        try:
            if not isinstance(row["observed_on"], str) or not ISO_DATE.fullmatch(row["observed_on"]):
                raise ValueError("Invalid observation date")
            day = date.fromisoformat(row["observed_on"])
        except (TypeError, ValueError):
            continue
        days.append(day)
        week = day.isocalendar()
        weeks_count[f"{week.year}-W{week.week:02d}"] += 1
    outcomes = {row["status"]: row["count"] for row in db.execute(
        "SELECT status,COUNT(*) AS count FROM scan_outcomes GROUP BY status"
    )} if _table(db, "scan_outcomes") else None
    return {"observations": len(observations), "distinct_companies": len({row["company"].lower() for row in observations}),
            "by_source": dict(Counter(row["source"] for row in observations)),
            "outcome_counts": outcomes, "first_seen": min(days).isoformat() if days else None,
            "last_seen": max(days).isoformat() if days else None,
            "added_per_week": [{"week": week, "count": weeks_count[week]} for week in sorted(weeks_count)[-weeks:]],
            "invalid_dates": len(observations) - len(days), "source": "scan_observations and scan_outcomes"}


def _portals(db: sqlite3.Connection, config: Path, scan: dict | None) -> dict | None:
    if not config.is_file():
        return None
    try:
        values = yaml.safe_load(config.read_text()) or {}
    except (OSError, yaml.YAMLError):
        return None
    if not isinstance(values, dict):
        return None
    companies = values.get("tracked_companies") if isinstance(values.get("tracked_companies"), list) else []
    boards = values.get("job_boards") if isinstance(values.get("job_boards"), list) else []
    names = {item.get("name", "").lower() for item in companies if isinstance(item, dict) and isinstance(item.get("name"), str)}
    observed = {row["company"].lower() for row in db.execute("SELECT DISTINCT company FROM scan_observations")} if scan is not None else set()
    streaks = defaultdict(int)
    if _table(db, "source_health"):
        for row in db.execute("SELECT source,status FROM source_health ORDER BY id"):
            streaks[row["source"].lower()] = 0 if row["status"] in ("reachable", "empty") else streaks[row["source"].lower()] + 1
    threshold = values.get("portal_health_threshold", 3)
    if type(threshold) is not int or threshold < 1:
        threshold = 3
    producing = len(names & observed) if scan is not None else None
    return {"configured_companies": len(companies), "configured_boards": len(boards),
            "producing_sources": len(scan["by_source"]) if scan is not None else None,
            "producing_companies": producing, "producing_pct": _percent(producing, len(names)) if producing is not None else None,
            "persistently_dead": sum(streaks.get(name, 0) >= threshold for name in names) if _table(db, "source_health") else None,
            "source": "portals.yml, scan_observations, source_health"}


def _followups(db: sqlite3.Connection, profile: Path) -> dict | None:
    if not _table(db, "application_activity") or not _table(db, "application_lifecycle"):
        return None
    counts = {str(row["opportunity_id"]): row["count"] for row in db.execute(
        "SELECT opportunity_id,COUNT(*) AS count FROM application_activity WHERE type='followup_sent' GROUP BY opportunity_id"
    )}
    statuses = {str(row["opportunity_id"]): row["status"] for row in db.execute(
        "SELECT opportunity_id,status FROM application_lifecycle"
    )}
    total = sum(counts.values())
    max_applied = cadence_config(profile)["applied_max_followups"]
    cold = sum(status == "applied" and counts.get(key, 0) >= max_applied for key, status in statuses.items())
    return {"total_followups": total, "applications_with_followups": len(counts),
            "applied_without_followup": sum(status == "applied" and key not in counts for key, status in statuses.items()),
            "average_per_followed_application": round(total / len(counts), 1) if counts else None,
            "active_applications_cold": cold,
            "active_applications_live": sum(status in ACTIVE for status in statuses.values()) - cold,
            "source": "application_activity and application_lifecycle"}


def _runs(db: sqlite3.Connection) -> dict | None:
    if not _table(db, "scan_runs"):
        return None
    rows = []
    malformed = 0
    for row in db.execute("SELECT created_at,summary FROM scan_runs ORDER BY id"):
        try:
            summary = json.loads(row["summary"])
            found = int(summary["found"])
            added = int(summary["newAdded"])
            errors = int(summary["errors"])
            handoff = int(summary.get("handoff", 0))
            if not ISO_DATE.fullmatch(row["created_at"][:10]):
                raise ValueError("Invalid scan run timestamp")
            date.fromisoformat(row["created_at"][:10])
        except (TypeError, ValueError, KeyError, json.JSONDecodeError):
            malformed += 1
            continue
        filtered = summary.get("filtered")
        filter_count = (sum(value for name, value in filtered.items() if name != "dupes")
                        if isinstance(filtered, dict) and all(type(value) is int and value >= 0
                                                           for value in filtered.values()) else None)
        rows.append({"date": row["created_at"][:10], "found": found, "added": added,
                     "complete": errors == 0 and handoff == 0, "filtered": filter_count})
    complete = [row for row in rows if row["complete"]]
    filter_rows = [row for row in complete if row["filtered"] is not None]
    return {"total_runs": len(rows), "incomplete_runs": len(rows) - len(complete),
            "malformed_runs": malformed, "last_run_date": max((row["date"] for row in rows), default=None),
            "average_found_per_complete_run": round(sum(row["found"] for row in complete) / len(complete), 1) if complete else None,
            "average_added_per_complete_run": round(sum(row["added"] for row in complete) / len(complete), 1) if complete else None,
            "filter_removal_pct": _percent(sum(row["filtered"] for row in filter_rows),
                                           sum(row["found"] for row in filter_rows)) if filter_rows else None,
            "filter_data_runs": len(filter_rows),
            "source": "scan_runs; complete means no recorded errors or handoffs"}


def stats_view(db: sqlite3.Connection, portals: Path, profile: Path) -> dict:
    """Keep missing sources explicit instead of turning absence into zero."""
    scan = _scan(db)
    return {"as_of": date.today().isoformat(), "sources": {name: _table(db, name) for name in (
                "opportunities", "application_lifecycle", "application_events", "application_activity",
                "scan_observations", "scan_outcomes", "scan_runs", "source_health", "results", "tasks", "artifacts")},
            "tracker": _tracker(db), "funnel": _funnel(db), "liveness": _liveness(db),
            "artifact_coverage": _artifact_coverage(db), "scan": scan,
            "portals": _portals(db, portals, scan), "followups": _followups(db, profile), "runs": _runs(db)}
