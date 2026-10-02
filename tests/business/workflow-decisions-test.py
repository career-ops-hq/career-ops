"""Check score-based attention, confirmed failures and deterministic ordering."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from career_ops.evaluation.decisions import classify, order


score = {"direction": 4, "compensation": 4, "company": None}
assert classify(score, {"status": "pass"}) == "focus"
assert classify(score, {"status": "uncertain"}) == "focus"
assert classify({**score, "company": 3}, {"status": "pass"}) == "deprioritize"
assert classify({**score, "compensation": None}, {"status": "pass"}) == "deprioritize"
assert classify({**score, "company": 5}, {"status": "pass"}) == "focus"
assert classify(score, {"status": "fail"}) == "discard"

rows = [
    {"opportunity_id": "later", "action": "focus", "deadline": None, "effort_days": 1, "scores": score},
    {"opportunity_id": "urgent", "action": "focus", "deadline": "2026-10-01", "effort_days": None, "scores": score},
    {"opportunity_id": "low", "action": "deprioritize", "deadline": "2026-09-30", "effort_days": 0, "scores": {**score, "company": 3}},
]
assert [row["opportunity_id"] for row in order(rows)] == ["urgent", "later", "low"]
assert [row["opportunity_id"] for row in order([
    {**rows[0], "opportunity_id": "z", "scores": {**score, "company": 5}},
    {**rows[0], "opportunity_id": "a", "scores": score},
])] == ["a", "z"]
for invalid in ("2026-02-30", "2026-9-30"):
    try:
        order([{**rows[0], "deadline": invalid}])
    except ValueError:
        pass
    else:
        raise AssertionError("invalid deadline accepted")

print("workflow decisions: action policy and ordering passed")
