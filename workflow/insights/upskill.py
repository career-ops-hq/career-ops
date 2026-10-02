"""Classify one JD and aggregate reviewed capability gaps for learning strategy."""

from __future__ import annotations

from collections import defaultdict
import json
from pathlib import Path
import re
import sqlite3

from workflow.skill_extract import extract_skills
from workflow.jd_skill_gap import scan_jd, classify_skill_gaps, split_skills_section


LOW_CONFIDENCE = {
    "empty-jd": "The JD file is empty, so nothing was checked.",
    "no-requirements-section": "No requirements section was recognized in this JD, so no text was scanned for skills. "
                               "This is not the same as \"no gaps\": the check did not run. Read the JD yourself before drafting.",
    "no-skill-candidates": "A requirements section was found and scanned, but no skill candidates were extracted from it. "
                           "This is not the same as \"no gaps\": nothing was classified. Read the JD yourself before drafting.",
}



def targeted_skill_gap(jd: str, cv: str) -> dict:
    """Preserve Node's named/prose/gap split and explicit inconclusive results."""
    candidates, saw_section = scan_jd(jd)
    buckets = classify_skill_gaps(candidates, cv)
    reason = None if candidates else "empty-jd" if not jd.strip() else "no-requirements-section" if not saw_section else "no-skill-candidates"
    return {"status": "classified" if candidates else "inconclusive", "reason": reason,
            "lowConfidence": {"reason": reason, "message": LOW_CONFIDENCE[reason]} if reason else None,
            "candidates": candidates, **buckets}


def _report_gaps(report: str) -> tuple[list[str], bool]:
    section = re.search(r"^## B\. 能力竞争力\s*\n(.*?)(?=^## |\Z)", report, re.M | re.S)
    if not section:
        return [], False
    covered = any("判定" in line and "|" in line for line in section[1].splitlines())
    gaps = []
    for line in section[1].splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) >= 2 and cells[1].lower() == "gap" and cells[0]:
            gaps.append(cells[0])
    return gaps, covered


def upskill_view(db: sqlite3.Connection, cv: Path, *, min_reports: int = 5) -> dict:
    """Aggregate actual evaluated gaps; no scalar fit is inferred from attractiveness."""
    if min_reports < 1:
        raise ValueError("Minimum reports must be positive")
    if not cv.is_file():
        return {"status": "source_missing", "source": "cv", "gaps": None}
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='results'").fetchone():
        return {"status": "source_missing", "source": "results", "gaps": None}
    reports = {}
    for row in db.execute("SELECT opportunity_id,module,payload FROM results WHERE module IN ('score','scan') ORDER BY rowid DESC"):
        reports.setdefault((str(row["opportunity_id"]), row["module"]), json.loads(row["payload"]))
    reviewed = []
    unparsed = limited = 0
    for (key, module), payload in reports.items():
        if module != "score" or payload.get("outcome") != "score":
            continue
        report = payload.get("artifact", {}).get("report", "")
        gaps, covered = _report_gaps(report)
        scan = reports.get((key, "scan"), {})
        core = scan.get("artifact", {}).get("core_capabilities") if scan.get("outcome") == "jd_report" else None
        if isinstance(core, list):
            for item in core:
                if isinstance(item, dict) and item.get("match") == "gap" and item.get("name"):
                    gaps.append(item["name"])
        if not covered and not isinstance(core, list):
            unparsed += 1
            continue
        if not covered:
            limited += 1
        reviewed.append({"opportunity_id": key, "gaps": list(dict.fromkeys(gaps))})
    if len(reviewed) < min_reports:
        return {"status": "insufficient_data", "reports": len(reviewed), "minimum": min_reports,
                "unparsed_reports": unparsed, "mandatory_only_reports": limited,
                "gap_source": "reviewed score capability Gap rows and scan core capability gaps", "gaps": None}
    named, _ = split_skills_section(re.sub(r"<!--[\s\S]*?-->", "", cv.read_text()))
    known = extract_skills(named)
    grouped = defaultdict(lambda: {"reports": set(), "topics": set()})
    topics = defaultdict(set)
    excluded = defaultdict(set)
    for report in reviewed:
        for topic in report["gaps"]:
            topics[topic].add(report["opportunity_id"])
            for skill in extract_skills(topic):
                if skill in known:
                    excluded[skill].add(report["opportunity_id"])
                    continue
                grouped[skill]["reports"].add(report["opportunity_id"])
                grouped[skill]["topics"].add(topic)
    gaps = []
    for skill, value in grouped.items():
        count = len(value["reports"])
        share = count / len(reviewed)
        tier = "Critical" if share >= 0.5 and count >= 3 else "High" if share >= 0.3 and count >= 2 else "Medium" if count >= 2 else "Low"
        gaps.append({"skill": skill, "reports": count, "share": round(share, 2), "tier": tier,
                     "sources": sorted(value["reports"]), "topics": sorted(value["topics"])})
    gaps.sort(key=lambda item: (-item["reports"], item["skill"]))
    topic_rows = [{"topic": topic, "reports": len(keys), "sources": sorted(keys)} for topic, keys in topics.items()]
    topic_rows.sort(key=lambda item: (-item["reports"], item["topic"]))
    return {"status": "observed", "reports": len(reviewed), "minimum": min_reports,
            "unparsed_reports": unparsed, "mandatory_only_reports": limited,
            "priority_basis": "gap prevalence among evaluated reports; scalar fit was retired",
            "topics": topic_rows, "gaps": gaps,
            "excludedAsKnown": [{"skill": skill, "reports": len(keys)} for skill, keys in sorted(excluded.items())],
            "knownSkills": sorted(known)}
