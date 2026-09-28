"""Exercise reply import, ambiguity, confirmation and business-write replay."""

import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.replies import _classify, classify, import_reply, invite_candidates, invite_signals, match, parse_pasted, view_reply


PYTHON = ROOT / "workflow" / ".venv" / "bin" / "python"


def call(directory, *args, ok=True):
    result = subprocess.run([PYTHON, "-B", "-m", "workflow.career_ops", "--directory", str(directory), "reply", *args],
                            cwd=ROOT, text=True, capture_output=True)
    assert (result.returncode == 0) == ok, result.stderr
    return json.loads(result.stdout) if ok else result.stderr


assert classify({"subject": "Job alert: invite you to interview"})["type"] == "Noise"
assert classify({"subject": "Unfortunately we are unable to offer you a position"})["suggested"] == "rejected"
assert classify({"subject": "Please pick a time for your interview"})["suggested"] == "interview"
assert invite_signals({"body_snippet": "Unfortunately we need to reschedule your interview"})["classification"] != "rejection"
assert _classify({"message": {"subject": "We have decided not to move forward with your application"}})["classification"]["suggested"] == "rejected"
assert invite_signals({"body_snippet": "Interview on https://zoom.us/j/123"})["platform"] == "Zoom"
assert invite_signals({"body_snippet": "Go to https://evil.example/zoom.us"})["platform"] is None
signals = invite_signals({"subject": "Interview with Acme for Req JR12345", "body_snippet": "See you on July 9, 2026 at meet.alex.com"})
assert signals["company"] == "Acme" and signals["req_id"] == "JR12345"
assert signals["date"] == "2026-07-09" and signals["is_ai_interviewer"]
assert invite_signals({"subject": "Interview", "body_snippet": "Company: Acme\nPlease schedule"})["company"] == "Acme"
assert parse_pasted("Subject: Hello\nFrom: hr@acme.com\n\nBody")["body_snippet"] == "Body"
assert parse_pasted("Subject: Hello\nFrom: hr@acme.com\n\nBody")["message_id"] == parse_pasted("Subject: Hello\nFrom: hr@acme.com\n\nBody")["message_id"]
assert invite_candidates({"company": "Acme Inc.", "req_id": "JR12345"}, [
    {"id": "1", "company": "Acme", "role": "Engineer", "notes": "JR12345", "status": "applied"},
    {"id": "2", "company": "Acme", "role": "Analyst", "notes": "", "status": "applied"},
])[0]["opportunity_id"] == "1"
assert match({"from": "recruiter@example.com", "subject": "Your interview"}, [
    {"id": "1", "company": "Example", "role": "Engineer", "notes": ""},
    {"id": "2", "company": "Example", "role": "Analyst", "notes": ""},
])["signals"] == ["ambiguous-match"]
assert match({"subject": "PHP interview"}, [{"id": "1", "company": "HP", "role": "Engineer", "notes": ""}])["opportunity_id"] is None

with tempfile.TemporaryDirectory() as temp:
    directory = Path(temp)
    assert call(directory, "view", "none") is None
    db = sqlite3.connect(directory / "opportunities.db")
    db.executescript("""
        CREATE TABLE opportunities(id INTEGER PRIMARY KEY,url TEXT,company TEXT,role TEXT,source TEXT,state TEXT,application_state TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE application_lifecycle(opportunity_id TEXT PRIMARY KEY,status TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE application_events(id INTEGER PRIMARY KEY,operation_id TEXT UNIQUE,opportunity_id TEXT,from_status TEXT,to_status TEXT,action TEXT,source TEXT,payload TEXT,package_result_key TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE application_activity(id INTEGER PRIMARY KEY,operation_id TEXT UNIQUE,opportunity_id TEXT,type TEXT,source TEXT,payload TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE application_followup_directives(id INTEGER PRIMARY KEY,operation_id TEXT UNIQUE,opportunity_id TEXT,kind TEXT,next_date TEXT,set_on TEXT,source TEXT,payload TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO opportunities(id,url,company,role,source,state,application_state) VALUES(1,'https://example.org/1','Acme','Software Engineer','provider','discovered','submitted');
        INSERT INTO application_lifecycle(opportunity_id,status) VALUES('1','applied');
        INSERT INTO application_events(operation_id,opportunity_id,from_status,to_status,action,source,payload) VALUES('submit-1','1',NULL,'applied','submit','user','{"notes":"Acme recruiter"}');
    """)
    db.close()
    message = {"message_id": "mail-1", "from": "hr@acme.com", "subject": "Schedule an interview at Acme", "body_snippet": "Please pick a time"}
    imported = import_reply(directory, message)
    assert imported["match"]["opportunity_id"] == "1"
    assert imported["suggested_status"] == "interview"
    assert import_reply(directory, message)["reused"]
    pasted = directory / "reply.txt"
    pasted.write_text("Subject: Acme interview\nFrom: hr@acme.com\n\nPlease schedule an interview")
    assert call(directory, "import", str(pasted))["suggested_status"] == "interview"
    assert call(directory, "import", str(pasted))["reused"]
    assert call(directory, "paste", str(pasted))["reused"]
    assert len(call(directory, "import", json.dumps([message, parse_pasted(pasted.read_text())]))) == 2
    assert "signal must be a string" in call(directory, "import", json.dumps({**message, "message_id": "bad-signal", "signal": []}), ok=False)
    assert "conflicts" in call(directory, "import", json.dumps({**message, "subject": "changed"}), ok=False)
    assert view_reply(directory, "mail-1")["confirmed_at"] is None
    assert "requires --confirmed" in call(directory, "confirm", "mail-1", "--opportunity", "1", "--status", "interview", ok=False)
    confirmed = call(directory, "confirm", "mail-1", "--opportunity", "1", "--status", "interview", "--confirmed")
    assert confirmed["status"] == "interview"
    replay = call(directory, "confirm", "mail-1", "--opportunity", "1", "--status", "interview", "--confirmed")
    assert replay["reused"], replay
    db = sqlite3.connect(directory / "opportunities.db")
    db.execute("UPDATE inbound_replies SET confirmed_at=NULL WHERE message_id='mail-1'")
    db.execute("INSERT INTO application_activity(operation_id,opportunity_id,type,source,payload) VALUES(?,?,?,?,?)",
               ("followup-note-1", "1", "followup_sent", "user", '{"notes":"Wrote to sam@example.org"}'))
    db.commit()
    assert not call(directory, "confirm", "mail-1", "--opportunity", "1", "--status", "interview", "--confirmed")["reused"]
    domain_reply = import_reply(directory, {"message_id": "domain-1", "from": "recruiter@alumni.example.org", "subject": "We would like to chat", "body_snippet": "Next steps"})
    assert domain_reply["match"]["opportunity_id"] == "1" and "sender-domain" in domain_reply["match"]["signals"]
    assert db.execute("SELECT status FROM application_lifecycle WHERE opportunity_id='1'").fetchone()[0] == "interview"
    assert db.execute("SELECT COUNT(*) FROM application_events WHERE opportunity_id='1'").fetchone()[0] == 2
    assert db.execute("SELECT COUNT(*) FROM application_activity WHERE type='reply_suggested'").fetchone()[0] == 3
    db.executescript("""
        INSERT INTO opportunities(id,url,company,role,source,state,application_state) VALUES(2,'https://example.org/2','Acme','Data Analyst','provider','discovered','submitted');
        INSERT INTO application_lifecycle(opportunity_id,status) VALUES('2','applied');
        INSERT INTO application_events(operation_id,opportunity_id,from_status,to_status,action,source,payload) VALUES('submit-2','2',NULL,'applied','submit','user','{}');
    """)
    db.close()
    ambiguous = import_reply(directory, {"message_id": "ambiguous", "from": "hr@acme.com", "subject": "Acme interview", "body_snippet": "Schedule a time"})
    assert ambiguous["match"]["signals"] == ["ambiguous-match"]
    assert ambiguous["suggested_status"] is None
    assert "requires --reason" in call(directory, "confirm", "ambiguous", "--opportunity", "1", "--status", "interview", "--confirmed", ok=False)
    assert call(directory, "confirm", "ambiguous", "--opportunity", "2", "--status", "interview", "--reason", "User checked requisition", "--confirmed")["status"] == "interview"
    assert call(directory, "confirm", "ambiguous", "--opportunity", "2", "--status", "interview", "--reason", "User checked requisition", "--confirmed")["reused"]
    db = sqlite3.connect(directory / "opportunities.db")
    assert db.execute("SELECT status FROM application_lifecycle WHERE opportunity_id='2'").fetchone()[0] == "interview"
    assert db.execute("SELECT COUNT(*) FROM application_events WHERE opportunity_id='2'").fetchone()[0] == 2
    db.close()
