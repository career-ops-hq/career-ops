"""Verify Python report rendering remains compatible with the strict report contract."""

import json
from pathlib import Path
import subprocess
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
        "profile": "attractiveness:\n  model: attractiveness-v1\n  weights:\n    direction: 0.4\n    compensation: 0.3\n    team: 0.2\n    company: 0.1\n",
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
            "searched_at": "2026-09-20", "queries": ["pay", "team", "company"],
            "dimensions": {name: {"queries": [index], "conclusion": "Applicable evidence remains unavailable.", "next_step": "Confirm exact employer terms."} for index, name in enumerate(("compensation", "team", "company"))},
            "findings": [{"id": "f1", "url": "https://example.com/pay", "entity": "Example", "scope": "market", "status": "retrieved", "published_at": None, "limitation": "Market only, not an offer.", "source": "web1", "quote": "Primary market research excerpt."}],
        },
        "dimensions": {name: {"score": None, "rationale": "Insufficient applicable evidence.", "evidence": []} for name in ("direction", "compensation", "team", "company")},
        "sections": {name: "Complete evidence mapping, unknowns and specific next actions." for name in ("overview", "capabilities", "compensation", "questions", "legitimacy", "risks", "checklist")},
    }
    rendered = render_report(packet, evidence, assessment)
    validator = Path(__file__).resolve().parents[1] / "scoring-report.mjs"
    script = "import fs from 'node:fs'; const {validateReport}=await import(process.argv[1]); const p=process.argv[2]; validateReport(fs.readFileSync(p,'utf8'), {root:process.argv[3]});"
    checked = subprocess.run(["node", "--input-type=module", "-e", script, validator.as_uri(), str(directory / "report.md"), str(root)], text=True, capture_output=True)
    assert checked.returncode == 0, (checked.stdout, checked.stderr)
    invalid = json.loads(json.dumps(assessment))
    invalid["dimensions"]["direction"] = {"score": 4, "rationale": "Claimed direction fit.", "evidence": [{"source": "jd", "quote": "Invented quote"}]}
    try:
        render_report(packet, evidence, invalid)
        raise AssertionError("missing quote accepted")
    except ValueError as error:
        assert "Quote not found" in str(error)
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
    checked = subprocess.run(["node", "--input-type=module", "-e", script, validator.as_uri(),
                              str(directory / "report.md"), str(root)], text=True, capture_output=True)
    assert checked.returncode == 0, (checked.stdout, checked.stderr)
    bad_salary = {**salary_assessment, "advertised_comp": {
        "amount": "300k-400k", "currency": "USD", "quote": "Annual salary CNY 300k-400k"
    }}
    try:
        render_report(packet, salary_evidence, bad_salary)
        raise AssertionError("unquoted salary currency accepted")
    except ValueError as error:
        assert "currency" in str(error)

print("workflow report: strict contract compatibility and citation failure passed")
