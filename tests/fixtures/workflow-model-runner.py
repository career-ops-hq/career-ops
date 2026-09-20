"""Deterministic process boundary used by the public workflow CLI test."""

import json
import sys


phase = sys.argv[1]
payload = json.load(sys.stdin)
if phase == "evaluate":
    report = payload["inputs"]["jd_report"]
    if report["prescreen"]["status"] == "fail":
        print(json.dumps({
            "outcome": "exclude",
            "artifact": {"type": "exclusion", "reason": report["prescreen"]["reason"]},
            "tool_calls": 0,
        }))
        raise SystemExit
    print(json.dumps({
        "outcome": "score",
        "artifact": {
            "type": "score",
            "company": report["company"],
            "role": report["role"],
            "score": {"lower": 3.5, "upper": 4.5, "coverage": 0.75},
            "report": "# Verified score report",
        },
        "tool_calls": 3,
    }))
elif phase == "review":
    if payload["artifact"]["type"] == "score":
        assert payload["artifact"]["report"] == "# Verified score report"
    print(json.dumps({"verdict": "approve", "checks": {"grounded": "pass"}, "tool_calls": 1}))
else:
    raise SystemExit(f"unknown phase: {phase}")
