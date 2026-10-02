"""Verify confirmed application facts, optional material links, and durable replay."""

import json
import sqlite3
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PYTHON = ROOT / ".venv" / "bin" / "python"


def call(directory: Path, *args: str, ok: bool = True) -> dict:
    result = subprocess.run(
        [PYTHON, "-B", "-m", "career_ops", "--directory", directory, "application", *args],
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
        CREATE TABLE opportunities(id INTEGER PRIMARY KEY,url TEXT,company TEXT,role TEXT,source TEXT,state TEXT,application_state TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE evaluations(opportunity_id INTEGER PRIMARY KEY,created_at TEXT);
        CREATE TABLE artifacts(id INTEGER PRIMARY KEY,opportunity_id INTEGER,kind TEXT,path TEXT,sha256 TEXT);
        INSERT INTO opportunities(id,url,company,role,source,state,application_state) VALUES(42,'https://example.com/job/42','Example','Engineer','provider','discovered','none');
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
    assert call(directory, "submit", "42", "--confirmed", "--idempotency-key", "submit-42")["reused"]
    cross_action = call(directory, "transition", "42", "applied", "--confirmed", "--source", "candidate-confirmed", "--idempotency-key", "submit-42", ok=False)
    assert "Idempotency key conflicts" in cross_action["error"]
    unconfirmed_transition = call(directory, "transition", "42", "interview", "--source", "candidate-confirmed", "--idempotency-key", "unconfirmed-interview", ok=False)
    assert "requires --confirmed" in unconfirmed_transition["error"]
    missing_source = call(directory, "transition", "42", "interview", "--confirmed", "--idempotency-key", "missing-source", ok=False)
    assert "requires --source" in missing_source["error"]
    reused_after_progress = call(directory, "transition", "42", "interview", "--confirmed", "--source", "candidate-confirmed", "--idempotency-key", "interview-42")
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
    future_send = call(directory, "activity", "42", "followup_sent", "--confirmed", "--payload", '{"sent_at":"2099-01-01"}', "--idempotency-key", "future-send", ok=False)
    assert "cannot be in the future" in future_send["error"]
    repeated_transition = call(directory, "transition", "42", "interview", "--confirmed", "--source", "candidate-confirmed", "--idempotency-key", "interview-again", ok=False)
    assert "Invalid application transition" in repeated_transition["error"]
    invalid = call(directory, "transition", "42", "responded", "--confirmed", "--source", "candidate-confirmed", "--idempotency-key", "invalid-42", ok=False)
    assert "Invalid application transition" in invalid["error"]

    activity = call(directory, "activity", "42", "followup_sent", "--confirmed", "--payload", '{"channel":"email"}', "--idempotency-key", "followup-42")
    assert activity["recorded"] == "followup_sent"
    assert call(directory, "activity", "42", "followup_sent", "--confirmed", "--payload", '{"channel":"email"}', "--idempotency-key", "followup-42")["reused"]
    wrong_source = call(directory, "activity", "42", "followup_sent", "--confirmed", "--source", "another-source", "--payload", '{"channel":"email"}', "--idempotency-key", "followup-42", ok=False)
    assert "Idempotency key conflicts" in wrong_source["error"]
    bad_date = call(directory, "schedule", "42", "2026-02-31", "--confirmed", "--idempotency-key", "bad-date", ok=False)
    assert "real YYYY-MM-DD" in bad_date["error"]
    extra_value = call(directory, "retire", "42", "reason", "--confirmed", "--idempotency-key", "bad-retire", ok=False)
    assert "does not take a value" in extra_value["error"]
    scheduled = call(directory, "schedule", "42", "2026-10-10", "--confirmed", "--idempotency-key", "next-42")
    assert scheduled["scheduled"] == "2026-10-10"
    assert call(directory, "schedule", "42", "2026-10-10", "--confirmed", "--idempotency-key", "next-42")["reused"]
    assert call(directory, "retire", "42", "--confirmed", "--idempotency-key", "retire-42")["retired"]
    assert not call(directory, "reopen", "42", "--confirmed", "--idempotency-key", "reopen-42")["retired"]

    assert call(directory, "activity", "42", "followup_sent", "--confirmed", "--idempotency-key", "offer-42:activity")["recorded"] == "followup_sent"
    unconfirmed_outcome = call(directory, "outcome", "42", "offer_received", "--source", "employer-message", "--idempotency-key", "unconfirmed-offer", ok=False)
    assert "requires --confirmed" in unconfirmed_outcome["error"]
    outcome = call(directory, "outcome", "42", "offer_received", "--confirmed", "--source", "employer-message", "--idempotency-key", "offer-42")
    assert outcome["status"] == "offer"
    assert outcome["outcome"] == "offer_received"
    assert outcome["preserved_artifacts"] == [{"kind": "verified-application-pdf", "path": "/review/resume.pdf", "sha256": "sha-42"}]
    replayed_outcome = call(directory, "outcome", "42", "offer_received", "--confirmed", "--source", "employer-message", "--idempotency-key", "offer-42")
    assert replayed_outcome["reused"] and replayed_outcome["preserved_artifacts"] == outcome["preserved_artifacts"]
    cross_outcome = call(directory, "transition", "42", "offer", "--confirmed", "--source", "employer-message", "--payload", '{"outcome":"offer_received"}', "--idempotency-key", "offer-42", ok=False)
    assert "Idempotency key conflicts" in cross_outcome["error"]
    assert call(directory, "activity", "42", "offer_prepared", "--confirmed", "--payload", '{"evidence":{"path":"/review/offer-notes.md","sha256":"offer-sha"}}', "--idempotency-key", "offer-prep-42")["recorded"] == "offer_prepared"
    assert call(directory, "outcome", "42", "hired", "--confirmed", "--source", "employer-message", "--idempotency-key", "hired-42")["status"] == "hired"

    view = call(directory, "view", "42")
    assert view["status"] == "hired"
    assert view["opportunity"]["company"] == "Example"
    assert view["artifacts"][0]["path"] == "/review/resume.pdf"
    assert view["confirmedPackage"] is None
    assert view["events"][0]["packageResultKey"] is None
    assert [item["kind"] for item in view["followupDirectives"]] == ["schedule", "retire", "reopen"]
    offer_activity = next(item for item in view["activities"] if item["type"] == "offer_prepared")
    assert offer_activity["payload"]["evidence"]["sha256"] == "offer-sha"
    assert offer_activity["source"] == "candidate-confirmed"
    assert [event["toStatus"] for event in view["events"]] == ["applied", "interview", "offer", "hired"]
    database = sqlite3.connect(directory / "opportunities.db")
    assert database.execute("SELECT operation_id FROM application_activity WHERE type='outcome_recorded' ORDER BY id").fetchall() == [("offer-42",), ("hired-42",)]
    database.close()
    assert call(directory, "followups")["entries"] == []
    assert call(directory, "view")[0]["company"] == "Example"
    assert sqlite3.connect(directory / "opportunities.db").execute("SELECT application_state FROM opportunities WHERE id=42").fetchone()[0] == "submitted"

    database = sqlite3.connect(directory / "opportunities.db")
    database.executescript(
        """
        INSERT INTO opportunities(id,url,company,role,source,state,application_state) VALUES(43,'https://example.com/job/43','Example','Analyst','provider','discovered','none');
        INSERT INTO tasks VALUES('apply-43a','43','apply','completed','hash-a',1,NULL,'oii-333-v1','{}');
        INSERT INTO tasks VALUES('apply-43b','43','apply','completed','hash-b',1,NULL,'oii-333-v1','{}');
        INSERT INTO results VALUES('apply-43a','apply-43a','43','apply','hash-a','{"outcome":"package_confirmed","artifact":{"package_hash":"package-43a"}}');
        INSERT INTO results VALUES('apply-43b','apply-43b','43','apply','hash-b','{"outcome":"package_confirmed","artifact":{"package_hash":"package-43b"}}');
        """
    )
    database.close()
    for key in ("apply-1", "missing", 42):
        invalid_link = call(directory, "submit", "43", "--confirmed", "--payload", json.dumps({"package_result_key": key}), "--idempotency-key", f"invalid-link-{key}", ok=False)
        assert "package_result_key must identify" in invalid_link["error"]
    assert call(directory, "view", "43") is None
    selected = call(directory, "submit", "43", "--confirmed", "--payload", '{"package_result_key":"apply-43a"}', "--idempotency-key", "submit-43a")
    assert selected["status"] == "applied"
    assert call(directory, "view", "43")["events"][0]["packageResultKey"] == "apply-43a"
    assert call(directory, "view", "43")["confirmedPackage"]["packageHash"] == "package-43a"

    database = sqlite3.connect(directory / "opportunities.db")
    database.execute("INSERT INTO opportunities(id,url,company,role,source,state,application_state) VALUES(44,'https://example.com/job/44','Example','Engineer','provider','evaluated','none')")
    database.commit()
    database.close()
    manual_args = ("submit", "44", "--confirmed", "--source", "user-confirmed", "--payload", '{"notes":"Applied using default resume"}', "--idempotency-key", "manual-44")
    assert call(directory, *manual_args)["status"] == "applied"
    assert call(directory, *manual_args)["reused"]
    manual = call(directory, "view", "44")
    assert manual["confirmedPackage"] is None
    assert manual["opportunity"]["applicationState"] == "submitted"
    assert len(manual["events"]) == 1
    assert manual["events"][0]["payload"]["notes"] == "Applied using default resume"
    assert manual["events"][0]["source"] == "user-confirmed"
    assert manual["events"][0]["packageResultKey"] is None


with tempfile.TemporaryDirectory() as temporary:
    directory = Path(temporary)
    database = sqlite3.connect(directory / "opportunities.db")
    database.executescript(
        """
        CREATE TABLE application_lifecycle(opportunity_id INTEGER PRIMARY KEY,status TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE application_events(id INTEGER PRIMARY KEY,opportunity_id INTEGER,from_status TEXT,to_status TEXT,source TEXT,payload TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE application_activity(id INTEGER PRIMARY KEY,opportunity_id INTEGER,type TEXT,payload TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE opportunities(id INTEGER PRIMARY KEY,url TEXT,company TEXT,role TEXT,source TEXT,state TEXT,application_state TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE evaluations(opportunity_id INTEGER PRIMARY KEY,created_at TEXT);
        CREATE TABLE artifacts(id INTEGER PRIMARY KEY,opportunity_id INTEGER,kind TEXT,path TEXT,sha256 TEXT);
        CREATE TABLE results(result_key TEXT PRIMARY KEY,task_id TEXT,opportunity_id TEXT,module TEXT,input_hash TEXT,payload TEXT);
        INSERT INTO opportunities(id,url,company,role,source,state,application_state) VALUES(7,'https://example.com/job/7','Legacy','Engineer','provider','evaluated','submitted');
        INSERT INTO application_lifecycle VALUES(7,'applied',CURRENT_TIMESTAMP);
        INSERT INTO application_events(opportunity_id,to_status,source,payload) VALUES(7,'applied','candidate-confirmed','{}');
        """
    )
    database.close()
    assert call(directory, "view", "7")["events"][0]["toStatus"] == "applied"
    assert call(directory, "submit", "7", "--confirmed", "--idempotency-key", "legacy-event-1")["reused"]
    legacy_collision = call(directory, "transition", "7", "applied", "--confirmed", "--source", "candidate-confirmed", "--idempotency-key", "legacy-event-1", ok=False)
    assert "Idempotency key conflicts" in legacy_collision["error"]

print("workflow application lifecycle: transitions, activities, outcomes and idempotency passed")
