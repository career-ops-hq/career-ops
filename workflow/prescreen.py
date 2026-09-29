"""Evaluate extracted Stage 0 evidence without inferring missing facts."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone


def evaluate(value: dict) -> dict:
    if not isinstance(value, dict):
        raise ValueError("Prescreen evidence must be an object")
    failures, unknowns, missing = [], [], []

    def reason(code: str, gate: str, message: str, evidence=None) -> dict:
        return {"code": code, "gate": gate, "message": message, "evidence": evidence}

    if value.get("complete_jd") is not True:
        missing.append("complete_jd")
    if value.get("assessment_complete") is not True:
        missing.append("assessment_complete")
    gates = value.get("gates") if isinstance(value.get("gates"), dict) else {}
    for name in ("location", "employment", "compensation", "company_size"):
        gate = gates.get(name)
        if not isinstance(gate, dict) or gate.get("status") not in ("pass", "fail", "unknown"):
            missing.append(f"gates.{name}")
        elif gate["status"] == "fail":
            failures.append(reason(f"{name}_failed", name, gate.get("reason") or f"{name} gate failed", gate.get("evidence")))
        elif gate["status"] == "unknown":
            unknowns.append(reason(f"{name}_unknown", name, gate.get("reason") or f"{name} is unknown", gate.get("evidence")))
    years = value.get("years")
    numeric = lambda number: isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number)
    if not isinstance(years, dict) or "verified" not in years or not numeric(years.get("required")) or years["required"] < 0 or (
        years["verified"] is not None and (not numeric(years["verified"]) or years["verified"] < 0)
    ):
        missing.append("years")
    elif years["verified"] is None:
        unknowns.append(reason("years_unverified", "years", "Relevant tenure requires confirmation", years.get("evidence")))
    else:
        gap = years["required"] - years["verified"]
        if gap >= 3:
            failures.append(reason("years_gap_terminal", "years", f"Verified experience is {gap:g} years below the stated minimum", years.get("evidence")))
        elif gap > 0:
            unknowns.append(reason("years_gap_borderline", "years", f"Verified experience is {gap:g} years below the stated minimum", years.get("evidence")))
    capabilities = value.get("core_capabilities")
    if not isinstance(capabilities, list):
        missing.append("core_capabilities")
    else:
        valid = [item for item in capabilities if isinstance(item, dict)
                 and isinstance(item.get("name"), str) and item["name"].strip()
                 and isinstance(item.get("core"), bool) and isinstance(item.get("mandatory"), bool)
                 and item.get("match") in ("proven", "adjacent", "gap", "unverified")]
        if len(valid) != len(capabilities):
            missing.append("core_capabilities.items")
        gaps = [item for item in valid if item["core"] and item["mandatory"] and item["match"] == "gap"]
        if len(gaps) >= 2:
            failures.append(reason("multiple_core_capability_gaps", "core_capabilities", f"Missing {len(gaps)} core mandatory capabilities: " + ", ".join(item["name"] for item in gaps), [item.get("evidence") for item in gaps]))
        for item in valid:
            if item["core"] and item["mandatory"] and item["match"] in ("adjacent", "unverified"):
                unknowns.append(reason(f"core_capability_{item['match']}", "core_capabilities", f"{item['name']} is {item['match']}", item.get("evidence")))
    credentials = value.get("credentials")
    if not isinstance(credentials, list):
        missing.append("credentials")
    else:
        valid = [item for item in credentials if isinstance(item, dict)
                 and isinstance(item.get("name"), str) and item["name"].strip()
                 and isinstance(item.get("mandatory"), bool)
                 and item.get("status") in ("present", "absent", "unknown")]
        if len(valid) != len(credentials):
            missing.append("credentials.items")
        for item in valid:
            if not item["mandatory"]:
                continue
            if item["status"] == "absent":
                failures.append(reason("mandatory_credential_absent", "credentials", f"Mandatory credential absent: {item['name']}", item.get("evidence")))
            elif item["status"] != "present":
                unknowns.append(reason("mandatory_credential_unverified", "credentials", f"Mandatory credential unverified: {item['name']}", item.get("evidence")))
    status = "fail" if failures else "incomplete" if missing else "uncertain" if unknowns else "pass"
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {
        "schema": "career-ops/prescreen", "schema_version": 1, "rules_version": 2,
        "input_hash": hashlib.sha256(encoded.encode()).hexdigest(),
        "generated_at": datetime.now(timezone.utc).isoformat(), "status": status,
        "discard_reasons": failures, "uncertainties": unknowns, "missing": missing,
    }
