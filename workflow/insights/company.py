"""Build per-company evidence cards from retained application and scan facts."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sqlite3

import yaml

try:
    from workflow.company_keys import normalize_company
    from workflow.insights.reposts import aggregator_keys, repost_view
    from workflow.followup_cadence import applied_date_from_notes, calendar_day
except ModuleNotFoundError:
    from company_keys import normalize_company
    from insights.reposts import aggregator_keys, repost_view
    from followup_cadence import applied_date_from_notes, calendar_day


RESPONDED = {"responded", "interview", "offer", "hired", "rejected"}


def company_view(db: sqlite3.Connection, portals: Path, *, today: date | None = None,
                 silence_days: int = 28, stale_days: int = 365,
                 include_stale: bool = False, company: str | None = None) -> dict:
    """Report observed evidence and leave missing history explicit."""
    if silence_days < 1 or stale_days < 1:
        raise ValueError("Silence and stale windows must be positive")
    today = today or date.today()
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    required = {"opportunities", "application_lifecycle", "application_events"}
    reposts = repost_view(db, portals)
    aggregators, _ = aggregator_keys(portals)
    if not required <= tables and reposts["status"] == "source_missing" and not aggregators and not company:
        return {"status": "source_missing", "missing": sorted(required - tables), "companies": None}

    cards = {}

    def card(name: str) -> dict | None:
        key = normalize_company(name)
        if not key:
            return None
        return cards.setdefault(key, {"key": key, "company": name, "responsiveness": {"label": "no-history", "facts": []},
                                      "postingChurn": {"label": "no-scan-data", "clusters": []}})

    events = defaultdict(list)
    if "application_events" in tables:
        for row in db.execute("SELECT opportunity_id,to_status,payload,created_at FROM application_events ORDER BY id"):
            events[str(row["opportunity_id"])].append(dict(row))
    followups = defaultdict(int)
    if "application_activity" in tables:
        for row in db.execute("SELECT opportunity_id,COUNT(*) AS count FROM application_activity WHERE type='followup_sent' GROUP BY opportunity_id"):
            followups[str(row["opportunity_id"])] = row["count"]

    evaluated = ("(SELECT created_at FROM evaluations ev WHERE ev.opportunity_id=o.id ORDER BY rowid DESC LIMIT 1)"
                 if "evaluations" in tables else "NULL")
    application_rows = (db.execute(f"""SELECT o.id,o.company,o.created_at,l.status,{evaluated} AS evaluated_at
                                      FROM application_lifecycle l
                                      LEFT JOIN opportunities o ON CAST(o.id AS TEXT)=l.opportunity_id""")
                        if {"opportunities", "application_lifecycle"} <= tables else ())
    for row in application_rows:
        if row["company"] is None:
            continue
        current = card(row["company"])
        if current is None:
            continue
        key = str(row["id"])
        history = events[key]
        if row["status"] == "applied":
            first = next((item for item in history if item["to_status"] == "applied"), None)
            if first is None:
                continue
            try:
                payload = json.loads(first["payload"])
            except (TypeError, ValueError, json.JSONDecodeError):
                payload = {}
            explicit = calendar_day(payload.get("submitted_at"))
            noted = applied_date_from_notes(payload.get("notes"))
            evaluation = calendar_day(row["evaluated_at"][:10]) if row["evaluated_at"] else None
            opportunity = calendar_day(row["created_at"][:10]) if row["created_at"] else None
            recorded = calendar_day(first["created_at"][:10]) if first["created_at"] else None
            applied = explicit or noted or evaluation or opportunity or recorded
            if applied is None:
                continue
            basis = ("submitted_at" if explicit else "notes" if noted else "evaluation-date-proxy" if evaluation
                     else "opportunity-date-proxy" if opportunity else "recorded-at-proxy")
            age = (today - applied).days
            if age < silence_days:
                continue
            count = followups[key] if "application_activity" in tables else None
            current["responsiveness"]["facts"].append({
                "opportunity_id": key, "appliedDate": applied.isoformat(), "silentDays": age,
                "dateBasis": basis,
                "via": payload.get("via") if isinstance(payload.get("via"), str) else None,
                "followupsSent": count, "confidence": "confirmed-by-followups" if count else
                "unconfirmed" if count == 0 else "unknown",
                "stale": age > stale_days,
            })
        elif row["status"] in RESPONDED:
            first = next((item for item in history if item["to_status"] in RESPONDED), None)
            observed = first["created_at"][:10] if first else None
            try:
                age = (today - date.fromisoformat(observed)).days if observed else None
            except ValueError:
                age = None
            current["responsiveness"]["facts"].append({
                "opportunity_id": key, "outcome": row["status"], "responseRecordedOn": observed,
                "dateBasis": "event-recorded-at-proxy" if observed else None,
                "stale": age is not None and age > stale_days,
                **({"note": "a rejection is an answer"} if row["status"] == "rejected" else {}),
            })

    for cluster in reposts.get("clusters") or []:
        current = card(cluster["company"])
        if current is not None:
            current["postingChurn"]["clusters"].append({key: cluster[key] for key in ("role", "repostCount", "daysSpan", "lastSeen")})
    for aggregator in aggregators.values():
        card(aggregator)
    key = normalize_company(company) if company else None
    if company and key not in cards:
        card(company)

    for current in cards.values():
        facts = current["responsiveness"]["facts"]
        active = [fact for fact in facts if include_stale or not fact["stale"]]
        silent = any("silentDays" in fact for fact in active)
        answered = any("outcome" in fact for fact in active)
        current["responsiveness"]["label"] = (
            "mixed" if silent and answered else "silent-on-you" if silent else
            "responded-before" if answered else "no-history"
        )
        churn = current["postingChurn"]
        churn["label"] = ("no-scan-data" if reposts["status"] == "source_missing" else
                          "aggregator-not-evaluated" if current["key"] in aggregators else
                          "reposts-detected" if churn["clusters"] else "none-detected")

    selected = [item for item in cards.values() if key is None or item["key"] == key]
    if required <= tables and reposts["status"] != "source_missing":
        status = "observed"
    elif not required <= tables and reposts["status"] == "source_missing":
        status = "source_missing"
    else:
        status = "partial"
    return {"status": status,
            "missing": sorted(required - tables), "as_of": today.isoformat(), "silence_window_days": silence_days,
            "stale_after_days": stale_days, "sources": {"application_activity": "application_activity" in tables,
                                                    "application_lifecycle": "application_lifecycle" in tables,
                                                    "application_events": "application_events" in tables,
                                                    "scan_observations": reposts["status"] != "source_missing"},
            "companies": sorted(selected, key=lambda item: item["key"])}


REGIONS = {
    "canada": "north-america/canada", "united states": "north-america/united-states",
    "united states of america": "north-america/united-states", "usa": "north-america/united-states",
    "us": "north-america/united-states", "mexico": "north-america/mexico",
    "united kingdom": "europe/united-kingdom", "uk": "europe/united-kingdom",
    "germany": "europe/germany", "austria": "europe/austria", "switzerland": "europe/switzerland",
    "france": "europe/france", "belgium": "europe/belgium", "luxembourg": "europe/luxembourg",
    "japan": "asia/japan", "india": "asia/india", "turkey": "asia/turkey", "china": "asia/china",
    "saudi arabia": "middle-east/saudi-arabia", "uae": "middle-east/united-arab-emirates",
    "united arab emirates": "middle-east/united-arab-emirates", "qatar": "middle-east/qatar",
    "australia": "oceania/australia", "new zealand": "oceania/new-zealand",
}


def company_signals(view: dict, profile: Path, package: Path, *, include_stale: bool = False) -> dict:
    """Derive stable privacy-minimal no-response records; never send them."""
    region = None
    if profile.is_file():
        try:
            data = yaml.safe_load(profile.read_text()) or {}
            country = data.get("location", {}).get("country") if isinstance(data, dict) else None
            if isinstance(country, str) and country.strip():
                key = country.strip().lower()
                slug = re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", key))
                region = REGIONS.get(key) or (f"unmapped/{slug}" if slug else None)
        except (OSError, yaml.YAMLError, AttributeError):
            pass
    emitted_by = "career-ops"
    if package.is_file():
        try:
            version = json.loads(package.read_text()).get("version")
            if isinstance(version, str) and version:
                emitted_by += f" v{version}"
        except (OSError, ValueError):
            pass
    records, warnings = [], []
    for card in view.get("companies") or []:
        if card["responsiveness"]["label"] != "silent-on-you":
            continue
        if not region:
            warnings.append(f"region unavailable; signal omitted for {card['key']}")
            continue
        facts = [fact for fact in card["responsiveness"]["facts"]
                 if "silentDays" in fact and (include_stale or not fact["stale"])
                 and calendar_day(fact["appliedDate"])]
        if not facts:
            continue
        anchor = max(facts, key=lambda fact: fact["appliedDate"])
        month = anchor["appliedDate"][:7]
        via = anchor.get("via")
        channel = "unknown" if not isinstance(via, str) or not via.strip() else (
            "direct-employer" if via.strip() == "—" else "staffing-agency"
        )
        identity = f"no-response-friction|{card['key']}|{month}"
        records.append({"schemaVersion": 1, "companyKey": card["key"], "region": region,
                        "signalType": "no-response-friction", "detail": None,
                        "severity": "pattern" if len(facts) >= 2 else "single",
                        "sourceDetector": "company-history",
                        "sourceHash": "sha256:" + hashlib.sha256(identity.encode()).hexdigest(),
                        "observedAt": month, "emittedBy": emitted_by, "postingChannel": channel})
    return {"records": sorted(records, key=lambda item: item["companyKey"]), "warnings": warnings}
