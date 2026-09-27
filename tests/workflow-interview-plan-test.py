"""Check deterministic preparation-plan parity with the existing Node fixture."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workflow.interview_plan import build_preparation_plan, report_classifications, validate_preparation_plan


jd = "# Role\n\n## Requirements\n- Python, Kubernetes, Rust\n"
cv = "# Skills\nPython\n\n# Experience\nDeployed Kubernetes services.\n"
report = "| Requirement | Match | Evidence |\n|---|---|---|\n| Rust | Adjacent | Systems work, scope unverified |\n| Security clearance | Unverified | Recruiter question |"
plan = build_preparation_plan(company="Acme", role="Engineer", jd_text=jd, cv_text=cv, report_text=report, generated_at="2026-01-01T00:00:00.000Z")
by_requirement = {entry["requirement"]: entry["classification"] for entry in plan["requirements"]}
assert by_requirement["Python"] == "evidenced"
assert by_requirement["Kubernetes"] == "evidence_gap"
assert by_requirement["Rust"] == "adjacent"
assert by_requirement["Security clearance"] == "unverified"
assert len(report_classifications(report)) == 2
assert validate_preparation_plan(plan)
assert plan["pre_application"] and plan["interview_preparation"]
assert all(entry["classification"] != "evidenced" for entry in plan["interview_preparation"])
print("interview plan: JD/CV classification and report override parity passed")
