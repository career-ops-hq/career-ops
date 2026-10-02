"""Verify Python report rendering remains compatible with the strict report contract."""

import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workflow.report import render_report


with tempfile.TemporaryDirectory(prefix="career-ops-report-") as temporary:
    root = Path(temporary)
    directory = root / "draft"
    directory.mkdir()
    sources = {
        "cv": "Primary candidate evidence.",
        "profile": "attractiveness:\n  model: attractiveness-v3\n",
        "targeting": "Primary targeting evidence.",
        "rules": "Current scoring rules.",
    }
    for name, content in sources.items():
        (directory / f"{name}.txt").write_text(content)
    packet = {"root": str(root), "directory": str(directory), "sources": sources}
    evidence = {"company": "Example", "role": "Engineer", "complete_jd": True, "liveness": "active", "jd": "Build and maintain software products."}
    assessment = {
        "sources": [{"id": "web1", "text": "Primary market research excerpt."}],
        "research": {
            "searched_at": "2026-09-20", "queries": ["pay", "company"],
            "dimensions": {name: {"queries": [index], "conclusion": "Applicable evidence remains unavailable.", "next_step": "Confirm exact employer terms."} for index, name in enumerate(("compensation", "company"))},
            "findings": [{"id": "f1", "url": "https://example.com/pay", "entity": "Example", "scope": "market", "status": "retrieved", "published_at": None, "limitation": "Market only, not an offer.", "source": "web1", "quote": "Primary market research excerpt."}],
        },
        "dimensions": {name: {"score": None, "rationale": "Insufficient applicable evidence.", "evidence": []} for name in ("direction", "compensation", "company")},
        "sections": {name: "Complete evidence mapping, unknowns and specific next actions." for name in ("overview", "capabilities", "compensation", "questions", "legitimacy", "risks", "checklist")},
    }
    rendered = render_report(packet, evidence, assessment)
    assert "已留存可引用网页来源" in rendered["report"]
    assert rendered["scores"] == {"direction": None, "compensation": None, "company": None}
    assert "| 维度 | 分数 |" in rendered["report"] and "覆盖率" not in rendered["report"]
    sourced = {**evidence, "location_evidence": "China, Shanghai, Shanghai",
               "liveness_reason": "browser_snapshot at official job URL returned captured"}
    for section, claim in (("overview", "岗位办公城市未披露。"),
                           ("legitimacy", "冻结素材中不含岗位页面 liveness/快照。")):
        contradicted = json.loads(json.dumps(assessment))
        contradicted["sections"][section] = claim
        try:
            render_report(packet, sourced, contradicted)
            raise AssertionError("claim contradicting retained posting evidence accepted")
        except ValueError as error:
            assert "contradicts retained posting evidence" in str(error)
    missing_section = json.loads(json.dumps(assessment))
    del missing_section["sections"]["compensation"]
    try:
        render_report(packet, evidence, missing_section)
        raise AssertionError("incomplete report sections accepted")
    except ValueError as error:
        assert "Report sections are incomplete" in str(error)
    no_sources = json.loads(json.dumps(assessment))
    no_sources["sources"] = []
    no_sources["research"]["findings"] = []
    assert "未取得可引用网页；外部事项保持未知" in render_report(packet, evidence, no_sources)["report"]
    malformed_research = json.loads(json.dumps(assessment))
    malformed_research["research"]["findings"][0]["status"] = "unsupported"
    malformed_research["research"]["findings"][0]["source"] = None
    malformed_research["research"]["findings"][0]["quote"] = None
    try:
        render_report(packet, evidence, malformed_research)
        raise AssertionError("unsupported research access status accepted")
    except ValueError as error:
        assert "research access status" in str(error)
    render_report(packet, evidence, assessment)
    invalid = json.loads(json.dumps(assessment))
    invalid["dimensions"]["direction"] = {"score": 4, "rationale": "Claimed direction fit.", "evidence": [{"source": "jd", "quote": "Invented quote"}]}
    try:
        render_report(packet, evidence, invalid)
        raise AssertionError("missing quote accepted")
    except ValueError as error:
        assert "Quote not found" in str(error)
    invalid = json.loads(json.dumps(assessment))
    invalid["dimensions"]["direction"] = {"score": 4, "rationale": "Unsupported direction fit.",
                                            "evidence": [{"status": "search_only", "source": None, "quote": None}]}
    try:
        render_report(packet, evidence, invalid)
        raise AssertionError("unsourced dimension score accepted")
    except ValueError as error:
        assert "Citation requires a quote" in str(error)
    invalid = json.loads(json.dumps(assessment))
    invalid["dimensions"]["compensation"]["fact_to_inference"] = "Unexpected model field"
    try:
        render_report(packet, evidence, invalid)
        raise AssertionError("extra dimension field accepted")
    except ValueError as error:
        assert "compensation: invalid dimension fields" in str(error)
    salary_evidence = {**evidence, "jd": "Annual salary CNY 300k-400k for this role.", "captured_at": "2026-09-20"}
    salary_assessment = {**assessment, "advertised_comp": {
        "amount": "300k-400k", "currency": "CNY", "quote": "Annual salary CNY 300k-400k"
    }}
    paid = render_report(packet, salary_evidence, salary_assessment)
    assert "advertised_comp:" in paid["report"] and "300k-400k" in paid["report"]
    bad_salary = {**salary_assessment, "advertised_comp": {
        "amount": "300k-400k", "currency": "USD", "quote": "Annual salary CNY 300k-400k"
    }}
    try:
        render_report(packet, salary_evidence, bad_salary)
        raise AssertionError("unquoted salary currency accepted")
    except ValueError as error:
        assert "currency" in str(error)

print("workflow report: strict contract compatibility and citation failure passed")
