"""Check all retained seniority classification cases from the Node baseline."""

import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.discovery_filters import classify_tier


cases = json.loads((ROOT / "tests" / "fixtures" / "classify-tier-baseline.json").read_text())
for case in cases:
    actual = classify_tier(case["title"])
    assert actual == case["tier"], (case["title"], actual, case["tier"])

print(f"workflow seniority classification: {len(cases)} Node baseline cases passed")
