"""Render a frozen model assessment as the evidence-linked score report."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import yaml

from workflow.insights.salary import parse_amount


HEADINGS = (
    "A. 岗位概览", "B. 能力竞争力", "C. 入职吸引力", "D. 薪酬与需求",
    "E. 补证问题", "G. 岗位真实性", "Risk Summary", "Evaluation Checklist", "Machine Summary",
)
DIMENSIONS = ("direction", "compensation", "company")


def conflicting_sections(sections: dict, evidence: dict) -> list[str]:
    """Reject claims that deny direct posting facts retained by scan."""
    if not isinstance(sections, dict):
        return []
    conflicts = []
    for name, body in sections.items():
        if not isinstance(body, str):
            continue
        if evidence.get("location_evidence") and re.search(
            r"(?:地点|城市).{0,8}(?:未披露|未知|未提供|无法确认)", body
        ):
            conflicts.append(name)
        elif "browser_snapshot" in str(evidence.get("liveness_reason", "")) and re.search(
            r"(?:不含|缺少|没有|未提供).{0,16}(?:岗位页面|页面|快照|liveness)", body, re.I
        ):
            conflicts.append(name)
    return conflicts


def digest(value: bytes | str) -> str:
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def dimension_scores(dimensions: dict) -> dict:
    if set(dimensions) != set(DIMENSIONS):
        raise ValueError("Score dimensions must match")
    scores = {}
    for name in DIMENSIONS:
        dimension = dimensions[name]
        if (not isinstance(dimension, dict) or set(dimension) != {"score", "rationale", "evidence"}
                or not isinstance(dimension["rationale"], str) or not dimension["rationale"].strip()
                or not isinstance(dimension["evidence"], list)):
            raise ValueError(f"{name}: invalid dimension fields")
        score = dimension["score"]
        if score is not None and (type(score) is not int or not 1 <= score <= 5):
            raise ValueError(f"{name}: score must be null or an integer from 1 to 5")
        if score is not None and not dimension["evidence"]:
            raise ValueError(f"{name}: known score requires evidence")
        scores[name] = score
    return scores


def validate_research(research: dict, sources: dict[str, Path]) -> None:
    """Require the Node research audit contract before a scored report is written."""
    if not isinstance(research, dict) or not isinstance(research.get("searched_at"), str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", research["searched_at"]):
        raise ValueError("research date required")
    queries = research.get("queries")
    if not isinstance(queries, list) or not 1 <= len(queries) <= 5 or any(not isinstance(query, str) or not query.strip() for query in queries):
        raise ValueError("research requires 1–5 executed queries")
    dimensions = research.get("dimensions")
    if not isinstance(dimensions, dict) or set(dimensions) != {"compensation", "company"}:
        raise ValueError("research dimensions are incomplete")
    for name, dimension in dimensions.items():
        refs = dimension.get("queries") if isinstance(dimension, dict) else None
        if (not isinstance(refs, list) or not refs or any(type(index) is not int or not 0 <= index < len(queries) for index in refs)
                or any(not isinstance(dimension.get(field), str) or not dimension[field].strip() for field in ("conclusion", "next_step"))):
            raise ValueError(f"{name}: research conclusion or query reference is invalid")
    findings = research.get("findings")
    if not isinstance(findings, list):
        raise ValueError("research findings required")
    ids = set()
    for finding in findings:
        if not isinstance(finding, dict):
            raise ValueError("research finding must be an object")
        identifier = finding.get("id")
        if not isinstance(identifier, str) or not identifier.strip() or identifier in ids:
            raise ValueError("research finding IDs must be unique")
        ids.add(identifier)
        if finding.get("status") not in ("retrieved", "search_only", "failed", "excluded"):
            raise ValueError("research access status required")
        if finding.get("scope") not in ("role", "team", "company", "adjacent_role", "market", "unresolved"):
            raise ValueError("research scope required")
        if (not isinstance(finding.get("url"), str) or not re.match(r"^https?://", finding["url"])
                or any(not isinstance(finding.get(field), str) or not finding[field].strip() for field in ("entity", "limitation"))
                or finding.get("published_at") is not None and (not isinstance(finding["published_at"], str) or not finding["published_at"].strip())):
            raise ValueError("research URL, entity, limitations or publication date is invalid")
        if finding["status"] == "retrieved":
            source_id = finding.get("source")
            source = sources.get(source_id) if isinstance(source_id, str) else None
            if not isinstance(finding.get("quote"), str) or not finding["quote"].strip() or source is None or finding["quote"] not in source.read_text():
                raise ValueError("research quote missing from frozen source")
        elif finding.get("source") is not None or finding.get("quote") is not None:
            raise ValueError("unretrieved research cannot provide scored evidence")


def render_report(packet: dict, evidence: dict, assessment: dict) -> dict:
    root, directory = Path(packet["root"]), Path(packet["directory"])
    if evidence.get("complete_jd") is not True or evidence.get("liveness") != "active" or not evidence.get("jd", "").strip():
        raise ValueError("Complete live JD required")
    required_sections = ("overview", "capabilities", "compensation", "questions", "legitimacy", "risks", "checklist")
    sections = assessment.get("sections")
    if not isinstance(sections, dict) or any(not isinstance(sections.get(name), str) or not sections[name].strip() for name in required_sections):
        raise ValueError("Report sections are incomplete")
    conflicts = conflicting_sections(sections, evidence)
    if conflicts:
        raise ValueError(f"Report contradicts retained posting evidence: {', '.join(conflicts)}")
    files = {name: directory / f"{name}.txt" for name in packet["sources"]}
    files["jd"] = directory / "jd.txt"
    files["jd"].write_text(evidence["jd"])
    for index, source in enumerate(assessment.get("sources", []), 1):
        if source.get("id") != f"web{index}" or not source.get("text", "").strip():
            raise ValueError("External sources must be sequential web1, web2, ... with text")
        files[source["id"]] = directory / f"{source['id']}.txt"
        files[source["id"]].write_text(source["text"])
    validate_research(assessment.get("research"), files)
    score = dimension_scores(assessment["dimensions"])
    dimension_citations = [item for dimension in assessment["dimensions"].values() for item in dimension["evidence"]]
    if any(not isinstance(item, dict) or set(item) != {"source", "quote"} for item in dimension_citations):
        raise ValueError("Citation requires a quote from a frozen source")
    citations = dimension_citations + assessment["research"]["findings"]
    for citation in citations:
        if citation.get("status") not in (None, "retrieved"):
            if citation.get("quote") is not None or citation.get("source") is not None:
                raise ValueError("Unretrieved research cannot provide evidence")
            continue
        if not citation.get("quote") or citation.get("source") not in files:
            raise ValueError(
                f"Citation requires a quote from a frozen source: {citation.get('source')!r}"
            )
        source = files[citation["source"]].read_text()
        match = re.search(r"\s+".join(re.escape(word) for word in citation["quote"].split()), source, re.IGNORECASE)
        if not match:
            raise ValueError(f"Quote not found in frozen source: {citation['source']}")
        citation["quote"] = match.group(0)
    advertised = assessment.get("advertised_comp")
    if advertised is not None:
        if (not isinstance(advertised, dict) or set(advertised) != {"amount", "currency", "quote"}
                or any(not isinstance(advertised[key], str) or not advertised[key].strip()
                       for key in ("amount", "currency", "quote"))
                or parse_amount(advertised["amount"]) is None):
            raise ValueError("Advertised annual compensation must have a parseable amount and JD quote")
        quote = advertised["quote"]
        match = re.search(r"\s+".join(re.escape(word) for word in quote.split()), evidence["jd"], re.I)
        if not match or not re.search(r"\b(?:annual(?:ly)?|yearly|per year)\b|年薪|每年|/yr\b|/year\b", quote, re.I):
            raise ValueError("Advertised compensation requires exact annual JD evidence")
        if any(number not in quote for number in re.findall(r"\d[\d.,]*", advertised["amount"])):
            raise ValueError("Advertised amount must appear in the JD quote")
        currency = advertised["currency"]
        if currency != "UNKNOWN" and (not re.fullmatch(r"[A-Z]{3}", currency)
                                      or not re.search(r"(?<![A-Z])" + currency + r"(?![A-Z])", quote)):
            raise ValueError("Advertised currency must appear as an ISO code in the JD quote")
        advertised = {**advertised, "quote": match.group(0)}
    files["research"] = directory / "research.json"
    files["research"].write_text(json.dumps(assessment["research"], ensure_ascii=False, indent=2) + "\n")
    summary = {
        "report_format": "scoring-v2", "scoring_model": "attractiveness-v3",
        "company": evidence["company"], "role": evidence["role"], "complete_jd": True, "jd_source": "jd",
        "captured_at": evidence.get("captured_at"), "advertised_comp": advertised,
        "sources": [{"id": name, "path": str(path.relative_to(root)), "sha256": digest(path.read_bytes())} for name, path in files.items()],
        "dimensions": assessment["dimensions"],
    }
    table = "| 维度 | 分数 |\n|---|---|\n" + "\n".join(
        f"| {name} | {score[name] if score[name] is not None else 'Unknown'} |"
        for name in DIMENSIONS
    )
    findings = "\n".join(f"- {item['id']} {item['url']} {item['entity']}" for item in assessment["research"]["findings"]) or "- 无外部研究发现"
    research_status = ("已留存可引用网页来源" if any(item.get("status") == "retrieved" for item in assessment["research"]["findings"])
                       else "已检索，但未取得可引用网页；外部事项保持未知")
    bodies = {
        "A. 岗位概览": sections["overview"], "B. 能力竞争力": sections["capabilities"],
        "C. 入职吸引力": f"**入职吸引力分项：**\n\n{table}",
        "D. 薪酬与需求": sections["compensation"], "E. 补证问题": f"{sections['questions']}\n\n### 外部研究记录\n\n{findings}",
        "G. 岗位真实性": sections["legitimacy"], "Risk Summary": sections["risks"],
        "Evaluation Checklist": f"{sections['checklist']}\n\n联网研究：{research_status}；记录见 E. 补证问题。",
        "Machine Summary": f"```yaml\n{yaml.safe_dump(summary, allow_unicode=True, sort_keys=False, width=10_000).strip()}\n```",
    }
    if any(not isinstance(body, str) or len(body.strip()) < 20 or re.search(r"^## ", body, re.MULTILINE) for body in bodies.values()):
        raise ValueError("Report section missing or contains extra level-two headings")
    report = "\n\n".join(f"## {heading}\n\n{bodies[heading]}" for heading in HEADINGS) + "\n"
    (directory / "report.md").write_text(report)
    return {"report": report, "report_sha256": digest(report), "scores": score}
