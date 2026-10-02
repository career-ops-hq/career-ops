"""Check source-backed preparation classification and its Python CLI."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from career_ops.evaluation.preparation import build_preparation_plan, parse_report_classifications, validate_preparation_plan

JD = "# Role\n\n## Requirements\n- Python, Kubernetes, Rust\n"
CV = "# Skills\nPython\n\n# Experience\nDeployed Kubernetes services.\n"
REPORT = "| Requirement | Match | Evidence |\n|---|---|---|\n| Rust | Adjacent | Systems work, scope unverified |\n| Security clearance | Unverified | Recruiter question |"
plan = build_preparation_plan("Acme", "Engineer", JD, CV, report=REPORT, generated_at="2026-01-01T00:00:00.000Z")
by_requirement = {row["requirement"]: row["classification"] for row in plan["requirements"]}
assert by_requirement == {"Python": "evidenced", "Kubernetes": "evidence_gap", "Rust": "adjacent",
                          "Security clearance": "unverified"}
assert len(parse_report_classifications(REPORT)) == 2
assert plan["pre_application"] and plan["interview_preparation"]
assert validate_preparation_plan(plan)["valid"]
assert all(row["classification"] != "evidenced" for row in plan["pre_application"])
assert build_preparation_plan("Acme", "Engineer", "No headings", CV)["requirements"][0]["classification"] == "unverified"

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    (root / "config").mkdir()
    (root / "cv.md").write_text(CV)
    (root / "profile.yml").write_text("")
    (root / "jd.md").write_text(JD)
    output = root / "output" / "plan.json"
    env = {**os.environ, "CAREER_OPS_INPUT_ROOT": str(root)}
    run = subprocess.run([sys.executable, "-m", "career_ops", "insights", "preparation-plan",
                          "--jd", str(root / "jd.md"), "--company", "Acme", "--role", "Engineer",
                          "--output", str(output)], cwd=ROOT, env=env, capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    assert json.loads(output.read_text())["schema"] == "career-ops/preparation-plan"
