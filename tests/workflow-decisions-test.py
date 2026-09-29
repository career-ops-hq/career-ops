"""Check current action thresholds, unknown gates and deterministic ordering."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workflow.decisions import classify, order


score = {"lower": 3, "upper": 5, "coverage": 0.5}
assert classify(score, {"status": "pass"}, 4) == "verify"
assert classify({**score, "lower": 4}, {"status": "pass"}, 4) == "apply"
assert classify({**score, "upper": 3.9}, {"status": "pass"}, 4) == "deprioritize"
assert classify({**score, "lower": 4}, {"status": "uncertain"}, 4) == "verify"
assert classify(score, {"status": "fail"}, 4) == "discard"

rows = [
    {"opportunity_id": "later", "action": "apply", "deadline": None, "effort_days": 1, "coverage": 0.8, "lower": 4},
    {"opportunity_id": "urgent", "action": "apply", "deadline": "2026-10-01", "effort_days": None, "coverage": 0.6, "lower": 4},
    {"opportunity_id": "check", "action": "verify", "deadline": "2026-09-30", "effort_days": 0, "coverage": 1, "lower": 5},
]
assert [row["opportunity_id"] for row in order(rows)] == ["urgent", "later", "check"]
for invalid in ("2026-02-30", "2026-9-30"):
    try:
        order([{**rows[0], "deadline": invalid}])
    except ValueError:
        pass
    else:
        raise AssertionError("invalid deadline accepted")

print("workflow decisions: action policy and ordering passed")
