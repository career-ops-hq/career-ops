"""Check notification at-most-once business state across graph replays and failures."""

from pathlib import Path
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
print("notification graph: success and uncertain attempts are never repeated")
