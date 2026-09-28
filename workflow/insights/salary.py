"""Fold append-only compensation evidence without guessing pay or exchange rates."""

from __future__ import annotations

from collections import defaultdict
import json
import math
from pathlib import Path
import re
import sqlite3
from statistics import mean, median

import yaml


TRUST = {
    "actual": {"contract": 3, "offer-letter": 2, "recruiter-verbal": 1, "user": 0},
    "desired": {"user": 1, "profile": 0},
    "advertised": {"user": 2, "recruiter-verbal": 1, "jd": 0},
}
AMOUNT = re.compile(r"^([\d.,]+)\s*(k)?(?:\s*[-–—]\s*([\d.,]+)\s*(k)?)?$", re.I)


def parse_amount(raw: str | None) -> dict | None:
    """Parse one amount or range, including comma and period grouping."""
    value = str(raw or "").strip()
    if not value or value in {"?", "-"} or value.lower() in {"n/a", "na", "null"}:
        return None
    value = re.sub(r"[€$£¥]", "", value)
    value = re.sub(r"\s*[A-Za-z]{3}\s*$", "", value).strip()
    match = AMOUNT.fullmatch(value)
    if not match:
        return None

    def number(token: str, thousands: bool) -> float:
        token = token.replace(",", "")
        token = re.sub(r"(\d)\.(?=\d{3}(?!\d))", r"\1", token)
        return float(token) * (1000 if thousands else 1)

    try:
        low = number(match[1], bool(match[2] or match[4]))
        high = number(match[3], bool(match[4] or match[2])) if match[3] else low
    except ValueError:
        return None
    if not math.isfinite(low) or not math.isfinite(high):
        return None
    return {"min": min(low, high), "max": max(low, high), "mid": (low + high) / 2}


def _effective(kind: str, observations: list[dict]) -> dict | None:
    valid = [row for row in observations if row["type"] == kind and row["parsed"] is not None
             and row["source"] in TRUST[kind]]
    if not valid:
        return None
    top = max(valid, key=lambda row: (TRUST[kind][row["source"]], row["date"]))
    return {"value": top["parsed"]["mid"], "source": top["source"], "date": top["date"],
            "currency": top["currency"], "raw": top["amount"]}


def salary_fold(observations: list[dict], opportunities: dict[str, dict],
                profile_desired: dict | None = None) -> dict:
    """Keep every observation; calculate gaps only for proven matching currencies."""
    rows = []
    for source in observations:
        row = dict(source)
        row["currency"] = str(row.get("currency") or "UNKNOWN").upper()
        row["parsed"] = parse_amount(row.get("amount"))
        rows.append(row)
    profile = None
    if profile_desired and profile_desired.get("amount"):
        profile = {"opportunity_id": "*", "date": "0000-00-00", "type": "desired",
                   "amount": profile_desired["amount"], "currency": str(profile_desired.get("currency") or "UNKNOWN").upper(),
                   "source": "profile", "parsed": parse_amount(profile_desired["amount"])}
    quality = {
        "orphans": [], "unparseable": [
            {"opportunity_id": row["opportunity_id"], "type": row["type"], "raw": row["amount"],
             "source": row["source"]}
            for row in rows + ([profile] if profile else []) if row["parsed"] is None and row["amount"] not in ("", "?")
        ],
        "invalidSources": [
            {"opportunity_id": row["opportunity_id"], "type": row["type"], "source": row["source"]}
            for row in rows if row["type"] in TRUST and row["source"] not in TRUST[row["type"]]
        ],
        "currencyMismatches": [], "withoutActual": 0,
        "latestObservation": max((row["date"] for row in rows), default=None),
    }
    grouped = defaultdict(list)
    for row in rows:
        grouped[str(row["opportunity_id"])].append(row)
    for key, group in grouped.items():
        if key not in opportunities:
            quality["orphans"].append({"opportunity_id": key, "count": len(group)})
    applications = []
    by_currency = {}
    by_company_role = {}
    for key, metadata in opportunities.items():
        group = grouped.get(str(key), [])
        if not group and not profile:
            continue
        desired = _effective("desired", group + ([profile] if profile else []))
        advertised = _effective("advertised", group)
        actual = _effective("actual", group)

        def gap(label: str, from_value: dict | None) -> float | None:
            if not from_value or not actual:
                return None
            if from_value["currency"] != actual["currency"] or actual["currency"] == "UNKNOWN":
                quality["currencyMismatches"].append({"opportunity_id": key, "comparison": label,
                                                       "currencies": [from_value["currency"], actual["currency"]]})
                return None
            return (actual["value"] - from_value["value"]) / from_value["value"] * 100 if from_value["value"] else None

        advertised_gap = gap("advertised-vs-actual", advertised)
        desired_gap = gap("desired-vs-actual", desired)
        applications.append({"opportunity_id": key, "company": metadata["company"], "role": metadata["role"],
                             "desired": desired, "advertised": advertised, "actual": actual,
                             "trail": sorted(group, key=lambda row: row["date"]),
                             "advToActPct": advertised_gap, "desiredToActPct": desired_gap})
        if actual:
            currency = actual["currency"]
            aggregate = by_currency.setdefault(currency, {"confirmed": 0, "advGaps": [],
                                                           "atOrAboveAdvertised": 0, "atOrAboveDesired": 0,
                                                           "newestActual": None})
            aggregate["confirmed"] += 1
            aggregate["newestActual"] = max(filter(None, (aggregate["newestActual"], actual["date"])))
            if advertised_gap is not None:
                aggregate["advGaps"].append(advertised_gap)
                aggregate["atOrAboveAdvertised"] += actual["value"] >= advertised["value"]
            if desired_gap is not None:
                aggregate["atOrAboveDesired"] += actual["value"] >= desired["value"]
            company_role = f"{metadata['company']}|{metadata['role']}"
            role_aggregate = by_company_role.setdefault(company_role, {"company": metadata["company"],
                                                                   "role": metadata["role"], "confirmed": 0,
                                                                   "advToActPcts": []})
            role_aggregate["confirmed"] += 1
            if advertised_gap is not None:
                role_aggregate["advToActPcts"].append(advertised_gap)
    quality["withoutActual"] = sum(item["actual"] is None for item in applications)
    for item in by_currency.values():
        gaps = item.pop("advGaps")
        item["meanAdvToActPct"] = mean(gaps) if gaps else None
        item["medianAdvToActPct"] = median(gaps) if gaps else None
    return {"applications": applications, "aggregates": {"byCurrency": by_currency, "byCompanyRole": by_company_role},
            "quality": quality}


def salary_view(db: sqlite3.Connection, profile_path: Path) -> dict:
    """Read canonical SQLite observations and the current desired default."""
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "opportunities" not in tables:
        return {"status": "source_missing", "missing": ["opportunities"], "result": None}
    conditions = []
    if "results" in tables:
        conditions.append("EXISTS (SELECT 1 FROM results r WHERE CAST(r.opportunity_id AS TEXT)=CAST(o.id AS TEXT) AND r.module='score')")
    if "salary_observations" in tables:
        conditions.append("EXISTS (SELECT 1 FROM salary_observations s WHERE CAST(s.opportunity_id AS TEXT)=CAST(o.id AS TEXT))")
    selected = "SELECT o.id,o.company,o.role FROM opportunities o WHERE " + (" OR ".join(conditions) or "0")
    opportunities = {str(row["id"]): {"company": row["company"], "role": row["role"]}
                     for row in db.execute(selected)}
    observations = ([dict(row) for row in db.execute(
        "SELECT opportunity_id,date,type,amount,currency,source,note,round,interviewer FROM salary_observations ORDER BY id"
    )] if "salary_observations" in tables else [])
    if "results" in tables:
        latest_scores = {}
        for row in db.execute("SELECT opportunity_id,payload FROM results WHERE module='score' ORDER BY rowid DESC"):
            latest_scores.setdefault(str(row["opportunity_id"]), json.loads(row["payload"]))
        for opportunity_id, result in latest_scores.items():
            report = result.get("artifact", {}).get("report", "")
            match = re.search(r"^## Machine Summary\s*\n```(?:yaml|yml)\s*\n(.*?)\n```", report, re.M | re.S)
            if not match:
                continue
            try:
                summary = yaml.safe_load(match[1])
            except yaml.YAMLError:
                continue
            if not isinstance(summary, dict) or not summary.get("advertised_comp"):
                continue
            advertised = summary["advertised_comp"]
            amount = advertised.get("amount") if isinstance(advertised, dict) else advertised
            currency = advertised.get("currency") if isinstance(advertised, dict) else None
            if not isinstance(amount, str):
                continue
            if not currency:
                currency = re.search(r"\b[A-Z]{3}\b", amount)
                currency = currency.group() if currency else "UNKNOWN"
            captured = summary.get("captured_at")
            observations.append({"opportunity_id": opportunity_id, "date": str(captured)[:10] if captured else "",
                                 "type": "advertised", "amount": amount, "currency": currency, "source": "jd",
                                 "note": advertised.get("quote", "") if isinstance(advertised, dict) else "from retained score report",
                                 "report_sha256": result.get("artifact", {}).get("report_sha256"),
                                 "round": "", "interviewer": ""})
    profile = yaml.safe_load(profile_path.read_text()) if profile_path.is_file() else {}
    compensation = profile.get("compensation", {}) if isinstance(profile, dict) else {}
    desired = ({"amount": compensation["target_range"], "currency": compensation.get("currency")}
               if isinstance(compensation, dict) and compensation.get("target_range") else None)
    return {"status": "observed", "sources": {"salary_observations": "salary_observations" in tables,
                                               "scored_results": "results" in tables,
                                               "profile": profile_path.is_file()},
            "result": salary_fold(observations, opportunities, desired)}


def stated_view(db: sqlite3.Connection, opportunity_id: str) -> dict:
    """Recall every prior stated amount for one opportunity in date order."""
    if not opportunity_id.strip():
        raise ValueError("Stated salary lookup requires an opportunity ID")
    exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='salary_observations'").fetchone()
    if not exists:
        return {"status": "source_missing", "source": "salary_observations", "statements": None}
    rows = [dict(row) for row in db.execute(
        """SELECT date,amount,currency,source,note,round,interviewer
           FROM salary_observations WHERE opportunity_id=? AND type='stated' ORDER BY date,id""",
        (opportunity_id,),
    )]
    return {"status": "observed", "opportunity_id": opportunity_id, "statements": rows}
