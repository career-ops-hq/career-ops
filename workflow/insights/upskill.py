"""Classify one JD and aggregate reviewed capability gaps for learning strategy."""

from __future__ import annotations

from collections import defaultdict
import json
from pathlib import Path
import re
import sqlite3

try:
    from workflow.skill_extract import canonicalize, extract_skills
except ModuleNotFoundError:
    from skill_extract import canonicalize, extract_skills


REQUIREMENT = re.compile(
    r"^#{0,6}\s*(?:required|requirements|qualifications|must[- ]have|preferred|nice[- ]to[- ]have|"
    r"what\s+we(?:'|’)?\s*re\s+looking\s+for|what\s+you(?:(?:'|’)ll|\s+will)?\s+bring|"
    r"who\s+you\s+are|about\s+you|your\s+(?:background|experience|profile)|"
    r"you\s+(?:may|might|could)\s+be\s+a\s+good\s+fit|you(?:(?:'|’)ll|\s+will)?\s+have|"
    r"it(?:'|’)?s\s+important\s+to\s+us\s+that\s+you\s+have|"
    r"it\s+would\s+be\s+great\s+if\s+you\s+ha(?:ve|d)|ideal\s+candidate|"
    r"skills\s+(?:and|&)\s+experience)s?\b.*$", re.I | re.ASCII,
)
NON_REQUIREMENT = re.compile(
    r"^#{0,6}\s*(?:you\s+will(?!\s+have)|benefits?|perks?|benefits\s+and\s+perks|"
    r"compensation|salary|pay\s+range|what\s+we\s+offer|why\s+(?:join|work|this\s+role)|"
    r"about\s+(?:us|the\s+company|the\s+team|the\s+role)|how\s+(?:and\s+where\s+)?we\s+work|"
    r"equal\s+opportunity|eeo|diversity|interview\s+process|how\s+to\s+apply|to\s+apply|"
    r"our\s+(?:stack|process|values|mission))\b.*$", re.I | re.ASCII,
)
TOKEN = re.compile(r"\b([A-Z][A-Za-z0-9+.#]{0,29}[A-Za-z0-9+#](?:\.[a-z]{2,4})?)(?!\w)", re.ASCII)
STOPWORDS = set("""the and for with you your our this that these those must able ability strong excellent proven
a an or in of to as is are bachelor bachelors master masters degree diploma certification certificate experience
years year senior junior entry level minimum preferred required candidates candidate applicants applicant ideal successful
knowledge understanding familiarity exposure background skills skill communication team teams work working deep interest genuine
solid comfortable passion passionate track record real bonus plus hands proficiency fluency expertise demonstrated extensive
practical good great clear""".split())
LOW_CONFIDENCE = {
    "empty-jd": "The JD file is empty, so nothing was checked.",
    "no-requirements-section": "No requirements section was recognized in this JD, so no text was scanned for skills. "
                               "This is not the same as \"no gaps\": the check did not run. Read the JD yourself before drafting.",
    "no-skill-candidates": "A requirements section was found and scanned, but no skill candidates were extracted from it. "
                           "This is not the same as \"no gaps\": nothing was classified. Read the JD yourself before drafting.",
}


def _jd_skills(jd: str) -> tuple[list[str], bool]:
    skills = {}
    inside = seen = False
    for line in jd.splitlines():
        if NON_REQUIREMENT.search(line):
            inside = False
            continue
        if REQUIREMENT.search(line):
            inside = seen = True
            continue
        if inside and re.match(r"^#{1,6}\s", line):
            inside = False
        bullet = re.match(r"^\s*[-*•]\s*(.+)\r?$", line)
        if inside and bullet:
            for match in TOKEN.finditer(bullet[1]):
                token = match[1].strip()
                if len(token) > 1 and token.lower() not in STOPWORDS:
                    skills[token] = None
    return list(skills), seen


def _cv_regions(cv: str) -> tuple[str, str]:
    lines = cv.splitlines()
    heading = next(((index, len(match[1])) for index, line in enumerate(lines)
                    if (match := re.fullmatch(r"(#{1,6})\s*Skills\s*", line, re.I))), None)
    if heading is None:
        return "", cv
    index, level = heading
    start = index + 1
    end = next((line_number for line_number in range(start, len(lines))
                if (match := re.match(r"(#{1,6})\s", lines[line_number])) and len(match[1]) <= level), len(lines))
    section = lines[start:end]
    subheadings = [(offset, match[2].strip().lower()) for offset, line in enumerate(section)
                   if (match := re.match(r"(#{%d})\s+(.+)" % (level + 1), line))]
    if not subheadings or not any(title == "production engineering" for _, title in subheadings):
        return "\n".join(section), "\n".join(lines[:index] + lines[end:])
    named, supported = [], section[:subheadings[0][0]]
    for part, (offset, title) in enumerate(subheadings):
        stop = subheadings[part + 1][0] if part + 1 < len(subheadings) else len(section)
        content = section[offset + 1:stop]
        if title == "production engineering":
            named.extend(content)
        elif title != "in progress":
            supported.extend(content)
    return "\n".join(named), "\n".join(lines[:index] + supported + lines[end:])


def targeted_skill_gap(jd: str, cv: str) -> dict:
    """Preserve Node's named/prose/gap split and explicit inconclusive results."""
    candidates, saw_section = _jd_skills(jd)
    named, prose = _cv_regions(cv)
    named_canon, prose_canon = extract_skills(named), extract_skills(prose)
    buckets = {"existing": [], "supportedByResume": [], "gap": []}
    for skill in candidates:
        canonical = canonicalize(skill)
        known = canonical != skill or bool(extract_skills(skill))
        boundary = lambda text: bool(re.search(r"(?<!\w)" + re.escape(skill) + r"(?!\w)", text, re.I | re.ASCII))
        if (known and canonical in named_canon) or boundary(named):
            buckets["existing"].append(skill)
        elif (known and canonical in prose_canon) or boundary(prose):
            buckets["supportedByResume"].append(skill)
        else:
            buckets["gap"].append(skill)
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
    named, _ = _cv_regions(re.sub(r"<!--[\s\S]*?-->", "", cv.read_text()))
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
