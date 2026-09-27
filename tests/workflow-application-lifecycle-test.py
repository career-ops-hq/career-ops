"""Verify the Python lifecycle preserves Node behavior and adds durable idempotency."""

import json
import sqlite3
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / "workflow" / ".venv" / "bin" / "python"
CLI = ROOT / "workflow" / "career_ops.py"


def call(directory: Path, *args: str, ok: bool = True) -> dict:
    result = subprocess.run(
        [PYTHON, "-B", CLI, "--directory", directory, "application", *args],
        text=True, capture_output=True,
    )
    assert (result.returncode == 0) is ok, result.stderr
    return json.loads(result.stdout) if ok else {"error": result.stderr}


with tempfile.TemporaryDirectory() as temporary:
    directory = Path(temporary)
    database = sqlite3.connect(directory / "opportunities.db")
    database.executescript(
        """
        CREATE TABLE tasks(task_id TEXT PRIMARY KEY,opportunity_id TEXT,module TEXT,status TEXT,input_hash TEXT,attempt INTEGER,waiting_reason TEXT,workflow_version TEXT,input_payload TEXT);
        CREATE TABLE results(result_key TEXT PRIMARY KEY,task_id TEXT UNIQUE,opportunity_id TEXT,module TEXT,input_hash TEXT,payload TEXT);
        CREATE TABLE opportunities(id INTEGER PRIMARY KEY,url TEXT,company TEXT,role TEXT,source TEXT,state TEXT,application_state TEXT);
        CREATE TABLE artifacts(id INTEGER PRIMARY KEY,opportunity_id INTEGER,kind TEXT,path TEXT,sha256 TEXT);
        INSERT INTO opportunities VALUES(42,'https://example.com/job/42','Example','Engineer','provider','discovered','none');
        INSERT INTO artifacts VALUES(1,42,'verified-application-pdf','/review/resume.pdf','sha-42');
        INSERT INTO tasks VALUES('apply-1','42','apply','completed','hash',1,NULL,'oii-333-v1','{}');
        INSERT INTO results VALUES('apply-1','apply-1','42','apply','hash','{"outcome":"package_confirmed","artifact":{"version":2,"package_hash":"package-42","files":{"resume_pdf":"/review/resume.pdf"},"file_hashes":{"resume_pdf":"sha-42"}}}');
        """
    )
    database.close()

    missing_key = call(directory, "submit", "42", "--confirmed", ok=False)
    assert "requires --idempotency-key" in missing_key["error"]
    rejected = call(directory, "submit", "42", "--idempotency-key", "unconfirmed-42", ok=False)
    assert "requires --confirmed" in rejected["error"]

    submitted = call(directory, "submit", "42", "--confirmed", "--idempotency-key", "submit-42")
    assert submitted["status"] == "applied" and not submitted["reused"]
    checkpoint = sqlite3.connect(directory / "workflow-checkpoints.db")
    checkpoint.execute("DELETE FROM checkpoints")
    checkpoint.commit()
    checkpoint.close()
    assert call(directory, "submit", "42", "--confirmed", "--idempotency-key", "submit-42")["reused"]
    reused_after_progress = call(directory, "transition", "42", "interview", "--source", "candidate-confirmed", "--idempotency-key", "interview-42")
    assert reused_after_progress["status"] == "interview"
    assert call(directory, "submit", "42", "--confirmed", "--idempotency-key", "submit-42")["reused"]
    collision = call(directory, "activity", "42", "followup_sent", "--confirmed", "--idempotency-key", "submit-42", ok=False)
    assert "Idempotency key conflicts" in collision["error"]
    changed_payload = call(directory, "submit", "42", "--confirmed", "--payload", '{"receipt":"different"}', "--idempotency-key", "submit-42", ok=False)
    assert "Idempotency key conflicts" in changed_payload["error"]
    wrong_opportunity = call(directory, "submit", "43", "--confirmed", "--idempotency-key", "submit-42", ok=False)
    assert "Idempotency key conflicts" in wrong_opportunity["error"]
    invalid_payload = call(directory, "activity", "42", "followup_sent", "--confirmed", "--payload", "[]", "--idempotency-key", "invalid-payload", ok=False)
    assert "payload must be an object" in invalid_payload["error"]
    repeated_transition = call(directory, "transition", "42", "interview", "--idempotency-key", "interview-again", ok=False)
    assert "Invalid application transition" in repeated_transition["error"]
    invalid = call(directory, "transition", "42", "responded", "--source", "candidate-confirmed", "--idempotency-key", "invalid-42", ok=False)
    assert "Invalid application transition" in invalid["error"]

    activity = call(directory, "activity", "42", "followup_sent", "--confirmed", "--payload", '{"channel":"email"}', "--idempotency-key", "followup-42")
    assert activity["recorded"] == "followup_sent"
    assert call(directory, "activity", "42", "followup_sent", "--confirmed", "--payload", '{"channel":"email"}', "--idempotency-key", "followup-42")["reused"]

    outcome = call(directory, "outcome", "42", "offer_received", "--idempotency-key", "offer-42")
    assert outcome["status"] == "offer"
    assert call(directory, "activity", "42", "offer_prepared", "--confirmed", "--idempotency-key", "offer-prep-42")["recorded"] == "offer_prepared"
    assert call(directory, "outcome", "42", "hired", "--idempotency-key", "hired-42")["status"] == "hired"

    view = call(directory, "view", "42")
    assert view["status"] == "hired"
    assert view["opportunity"]["company"] == "Example"
    assert view["artifacts"][0]["path"] == "/review/resume.pdf"
    assert view["confirmedPackage"]["packageHash"] == "package-42"
    assert view["events"][0]["packageResultKey"] == "apply-1"
    assert [event["toStatus"] for event in view["events"]] == ["applied", "interview", "offer", "hired"]
    assert call(directory, "followups") == []
    assert call(directory, "view")[0]["company"] == "Example"
    assert sqlite3.connect(directory / "opportunities.db").execute("SELECT application_state FROM opportunities WHERE id=42").fetchone()[0] == "submitted"

    checkpoint = sqlite3.connect(directory / "workflow-checkpoints.db")
    assert checkpoint.execute("SELECT count(*) FROM checkpoints").fetchone()[0] >= 1
    checkpoint.close()

with tempfile.TemporaryDirectory() as temporary:
    directory = Path(temporary)
    database = sqlite3.connect(directory / "opportunities.db")
    database.executescript(
        """
        CREATE TABLE application_lifecycle(opportunity_id INTEGER PRIMARY KEY,status TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE application_events(id INTEGER PRIMARY KEY,opportunity_id INTEGER,from_status TEXT,to_status TEXT,source TEXT,payload TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE application_activity(id INTEGER PRIMARY KEY,opportunity_id INTEGER,type TEXT,payload TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE opportunities(id INTEGER PRIMARY KEY,url TEXT,company TEXT,role TEXT,source TEXT,state TEXT,application_state TEXT);
        CREATE TABLE artifacts(id INTEGER PRIMARY KEY,opportunity_id INTEGER,kind TEXT,path TEXT,sha256 TEXT);
        CREATE TABLE results(result_key TEXT PRIMARY KEY,task_id TEXT,opportunity_id TEXT,module TEXT,input_hash TEXT,payload TEXT);
        INSERT INTO opportunities VALUES(7,'https://example.com/job/7','Legacy','Engineer','provider','evaluated','submitted');
        INSERT INTO application_lifecycle VALUES(7,'applied',CURRENT_TIMESTAMP);
        INSERT INTO application_events(opportunity_id,to_status,source,payload) VALUES(7,'applied','candidate-confirmed','{}');
        """
    )
    database.close()
    assert call(directory, "view", "7")["events"][0]["toStatus"] == "applied"

print("workflow application lifecycle: transitions, activities, outcomes and idempotency passed")
