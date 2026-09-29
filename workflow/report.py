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
DIMENSIONS = ("direction", "compensation", "team", "company")


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


def attractiveness(dimensions: dict, weights: dict) -> dict:
    if set(dimensions) != set(DIMENSIONS) or set(weights) != set(DIMENSIONS):
        raise ValueError("Score dimensions and weights must match")
    if any(not isinstance(weight, (int, float)) or weight <= 0 for weight in weights.values()) or abs(sum(weights.values()) - 1) >= 1e-9:
        raise ValueError("Weights must be positive and sum to one")
    lower = upper = coverage = 0.0
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
        lower += weights[name] * (score if score is not None else 1)
        upper += weights[name] * (score if score is not None else 5)
        coverage += weights[name] if score is not None else 0
    return {"lower": round(lower, 2), "upper": round(upper, 2), "coverage": round(coverage, 6)}


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
    profile = yaml.safe_load(packet["sources"]["profile"])
    score = attractiveness(assessment["dimensions"], profile["attractiveness"]["weights"])
    citations = [item for dimension in assessment["dimensions"].values() for item in dimension["evidence"]]
    citations += assessment["research"]["findings"]
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
        "report_format": "scoring-v2", "scoring_model": "attractiveness-v1", "score": None,
        "company": evidence["company"], "role": evidence["role"], "complete_jd": True, "jd_source": "jd",
        "captured_at": evidence.get("captured_at"), "advertised_comp": advertised,
        "sources": [{"id": name, "path": str(path.relative_to(root)), "sha256": digest(path.read_bytes())} for name, path in files.items()],
        "dimensions": assessment["dimensions"], "attractiveness": score,
    }
    table = "| 维度 | 分数 | 权重 |\n|---|---|---|\n" + "\n".join(
        f"| {name} | {assessment['dimensions'][name]['score'] if assessment['dimensions'][name]['score'] is not None else 'Unknown'} | {profile['attractiveness']['weights'][name] * 100:g}% |"
        for name in DIMENSIONS
    )
    findings = "\n".join(f"- {item['id']} {item['url']} {item['entity']}" for item in assessment["research"]["findings"]) or "- 无外部研究发现"
    research_status = ("已留存可引用网页来源" if any(item.get("status") == "retrieved" for item in assessment["research"]["findings"])
                       else "已检索，但未取得可引用网页；外部事项保持未知")
    bodies = {
        "A. 岗位概览": sections["overview"], "B. 能力竞争力": sections["capabilities"],
        "C. 入职吸引力": f"**入职吸引力：** {score['lower']:.2f}–{score['upper']:.2f}/5；证据覆盖率：{score['coverage'] * 100:g}%\n\n{table}",
        "D. 薪酬与需求": sections["compensation"], "E. 补证问题": f"{sections['questions']}\n\n### 外部研究记录\n\n{findings}",
        "G. 岗位真实性": sections["legitimacy"], "Risk Summary": sections["risks"],
        "Evaluation Checklist": f"{sections['checklist']}\n\n联网研究：{research_status}；记录见 E. 补证问题。",
        "Machine Summary": f"```yaml\n{yaml.safe_dump(summary, allow_unicode=True, sort_keys=False, width=10_000).strip()}\n```",
    }
    if any(not isinstance(body, str) or len(body.strip()) < 20 or re.search(r"^## ", body, re.MULTILINE) for body in bodies.values()):
        raise ValueError("Report section missing or contains extra level-two headings")
    report = "\n\n".join(f"## {heading}\n\n{bodies[heading]}" for heading in HEADINGS) + "\n"
    (directory / "report.md").write_text(report)
    return {"report": report, "report_sha256": digest(report), "attractiveness": score}
