"""Check notification at-most-once business state across graph replays and failures."""

from pathlib import Path
import os
import subprocess
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workflow.notifications import deliver


def check(outcome):
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        payload = {
            "opportunity_id": "unit-opportunity", "report_hash": "unit-report-hash",
            "title": "reviewed role · 3–5/5 (50%)", "report": "unit report",
        }
        calls = []

        def sender(message):
            calls.append(message)
            if outcome == "timeout":
                raise TimeoutError("remote result unknown")
            if outcome == "failure":
                raise RuntimeError("remote request failed")
            if outcome == "crash":
                raise SystemExit("process stopped after claim")

        with patch("workflow.notifications.eligible_report", return_value=payload):
            if outcome == "crash":
                try:
                    deliver(directory, payload["opportunity_id"], sender)
                except SystemExit:
                    pass
                else:
                    raise AssertionError("Expected simulated process stop")
                first = {"status": "uncertain"}
            else:
                first = deliver(directory, payload["opportunity_id"], sender)
            second = deliver(directory, payload["opportunity_id"], sender)
        assert len(calls) == 1
        expected = "uncertain" if outcome in ("failure", "timeout", "crash") else "delivered"
        assert first["status"] == second["status"] == expected


check("success")
check("failure")
check("timeout")
check("crash")

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    python = root / "workflow/.venv/bin/python"
    python.parent.mkdir(parents=True)
    python.write_text('#!/bin/sh\nprintf "%s|%s\\n" "${CAREER_OPS_NOTIFICATIONS_ENABLED:-}" "$*" >> "$CALLS"\n')
    python.chmod(0o755)
    calls = root / "calls"
    environment = {key: value for key, value in os.environ.items() if key != "CAREER_OPS_NOTIFICATIONS_ENABLED"}
    subprocess.run(["sh", str(Path(__file__).resolve().parents[1] / "scripts/career-ops-score.sh")],
                   cwd=root, env={**environment, "CALLS": str(calls)}, check=True)
    assert calls.read_text().splitlines() == [
        "|-B -m workflow.career_ops cron-score",
        "1|-B -m workflow.notifications cron",
    ]
print("notification graph and scheduled wrapper: delivery and replay checks passed")
