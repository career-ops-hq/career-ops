"""Check Python CV fact rules against frozen Node outputs and CLI behavior."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.cv_facts import fact_claims, metric_claims, verify_facts, verify_document


cases = json.loads((ROOT / "tests" / "fixtures" / "cv-fact-baseline.json").read_text())
for case in cases:
    actual = verify_facts(case["target"], case["source"], case["config"])
    assert actual == case["expected"], (case, actual)

claims = json.loads((ROOT / "tests" / "fixtures" / "cv-fact-claims-baseline.json").read_text())
for case in claims:
    assert fact_claims(case["text"]) == case["facts"], case
    assert metric_claims(case["text"]) == case["metrics"], case

with tempfile.TemporaryDirectory(prefix="career-ops-cv-facts-") as temporary:
    root = Path(temporary)
    (root / "config").mkdir()
    (root / "cv.md").write_text("Managed 20 staff")
    document = root / "resume.txt"
    document.write_text("Managed 45 staff")
    assert verify_document(document.read_text(), root)["verdict"] == "block"
    rejected = subprocess.run(
        [sys.executable, "-m", "workflow.cv_facts", str(document), "--source", str(root / "cv.md"), "--json"],
        cwd=ROOT, text=True, capture_output=True,
    )
    assert rejected.returncode == 1 and json.loads(rejected.stdout)["invented"] == ["45 staff"]
    document.write_text("Managed 20 personnel")
    accepted = subprocess.run(
        [sys.executable, "-m", "workflow.cv_facts", str(document), "--source", str(root / "cv.md"), "--json"],
        cwd=ROOT, text=True, capture_output=True,
    )
    assert accepted.returncode == 0 and json.loads(accepted.stdout)["verdict"] == "pass"

print("workflow CV fact gate: frozen Node parity and Python CLI passed")
