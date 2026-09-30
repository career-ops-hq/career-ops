"""Check score-based attention, confirmed failures and deterministic ordering."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workflow.decisions import classify, order


score = {"lower": 3, "upper": 5, "coverage": 0.5}
assert classify(score, {"status": "pass"}, 4) == "focus"
assert classify(score, {"status": "uncertain"}, 4) == "focus"
assert classify({**score, "coverage": 0.25}, {"status": "pass"}, 4) == "deprioritize"
assert classify({**score, "lower": 4, "coverage": 0}, {"status": "pass"}, 4) == "focus"
assert classify(score, {"status": "fail"}, 4) == "discard"

rows = [
    {"opportunity_id": "later", "action": "focus", "deadline": None, "effort_days": 1, "coverage": 0.8, "lower": 4, "upper": 5},
    {"opportunity_id": "urgent", "action": "focus", "deadline": "2026-10-01", "effort_days": None, "coverage": 0.6, "lower": 4, "upper": 5},
    {"opportunity_id": "low", "action": "deprioritize", "deadline": "2026-09-30", "effort_days": 0, "coverage": 1, "lower": 2, "upper": 3},
]
assert [row["opportunity_id"] for row in order(rows)] == ["urgent", "later", "low"]
assert [row["opportunity_id"] for row in order([
    {**rows[0], "opportunity_id": "high-coverage", "coverage": 0.6, "lower": 3, "upper": 5},
    {**rows[0], "opportunity_id": "higher-score", "coverage": 0.5, "lower": 4, "upper": 5},
])] == ["higher-score", "high-coverage"]
for invalid in ("2026-02-30", "2026-9-30"):
    try:
        order([{**rows[0], "deadline": invalid}])
    except ValueError:
        pass
    else:
        raise AssertionError("invalid deadline accepted")

print("workflow decisions: action policy and ordering passed")
