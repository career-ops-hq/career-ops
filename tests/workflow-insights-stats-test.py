"""Check insight counts, event funnel and missing-source semantics."""

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from workflow.insights.stats import stats_view


with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    db = sqlite3.connect(root / "facts.db")
    db.row_factory = sqlite3.Row
    empty = stats_view(db, root / "portals.yml", root / "profile.yml")
    assert empty["tracker"] is None and empty["scan"] is None and empty["runs"] is None
    db.executescript("""
        CREATE TABLE opportunities(id INTEGER PRIMARY KEY,company TEXT,state TEXT,source TEXT);
        CREATE TABLE application_lifecycle(opportunity_id TEXT,status TEXT);
        CREATE TABLE application_events(opportunity_id TEXT,to_status TEXT);
        CREATE TABLE application_activity(opportunity_id TEXT,type TEXT);
        CREATE TABLE results(opportunity_id TEXT,module TEXT,payload TEXT);
        CREATE TABLE tasks(opportunity_id TEXT,status TEXT,waiting_reason TEXT);
        CREATE TABLE scan_observations(id INTEGER PRIMARY KEY,opportunity_id INTEGER,company TEXT,observed_on TEXT);
        CREATE TABLE scan_outcomes(status TEXT);
        CREATE TABLE scan_runs(id INTEGER PRIMARY KEY,created_at TEXT,summary TEXT);
        CREATE TABLE source_health(id INTEGER PRIMARY KEY,source TEXT,status TEXT);
        CREATE TABLE artifacts(opportunity_id TEXT,kind TEXT);
        INSERT INTO opportunities VALUES(1,'Acme','evaluated','workday'),(2,'Beta','discovered','board');
        INSERT INTO application_lifecycle VALUES('1','rejected');
        INSERT INTO application_events VALUES('1','applied'),('1','responded'),('1','rejected');
        INSERT INTO application_activity VALUES('1','followup_sent');
        INSERT INTO tasks VALUES('1','waiting','source_access_unknown'),('2','waiting','user_review');
        INSERT INTO scan_observations(opportunity_id,company,observed_on) VALUES(1,'Acme','2026-01-01'),(2,'Beta','2026-01-08');
        INSERT INTO scan_outcomes VALUES('added'),('skipped_expired');
        INSERT INTO source_health(source,status) VALUES('Acme','network'),('Acme','reachable'),('Beta','auth');
    """)
    db.execute("INSERT INTO scan_runs(created_at,summary) VALUES(?,?)", ("2026-01-01", json.dumps({"found": 10, "newAdded": 2, "errors": 0})))
    db.execute("INSERT INTO scan_runs(created_at,summary) VALUES(?,?)", ("2026-01-08", json.dumps({"found": 0, "newAdded": 0, "errors": 1})))
    db.execute("INSERT INTO results VALUES(?,?,?)", ("1", "scan", json.dumps({
        "outcome": "jd_report", "artifact": {"liveness": "active"}
    })))
    db.execute("INSERT INTO results VALUES(?,?,?)", ("2", "scan", json.dumps({
        "outcome": "exclude", "artifact": {"type": "exclusion", "reason_code": "expired"}
    })))
    db.execute("INSERT INTO results VALUES(?,?,?)", ("1", "score", json.dumps({
        "outcome": "score", "artifact": {"report_sha256": "hash"}
    })))
    db.execute("INSERT INTO results VALUES(?,?,?)", ("1", "apply", json.dumps({
        "outcome": "package", "artifact": {"files": {"resume_pdf": "resume.pdf"}}
    })))
    db.commit()
    portals = root / "portals.yml"
    portals.write_text("tracked_companies:\n  - name: Acme\n  - name: Beta\njob_boards:\n  - name: Board\n")
    view = stats_view(db, portals, root / "profile.yml")
    assert view["tracker"]["opportunities"] == 2
    assert view["tracker"]["by_application_status"]["rejected"] == 1
    assert view["tracker"]["waiting_for_evidence"] == 1
    assert view["tracker"]["waiting_for_review"] == 1
    assert view["funnel"]["ever_applied"] == 1 and view["funnel"]["ever_responded"] == 1
    assert view["funnel"]["ever_interviewed"] == 0
    assert view["liveness"]["active_at_capture"] == 1
    assert view["liveness"]["expired_at_capture"] == 1
    assert view["artifact_coverage"]["score_reports"] == 1
    assert view["artifact_coverage"]["resume_pdfs"] == 1
    assert view["scan"]["distinct_companies"] == 2 and view["scan"]["added_per_week"][0]["count"] == 1
    assert view["portals"]["configured_companies"] == 2 and view["portals"]["producing_pct"] == 100
    assert view["followups"]["total_followups"] == 1
    assert view["runs"]["total_runs"] == 2 and view["runs"]["incomplete_runs"] == 1
    assert view["runs"]["average_found_per_complete_run"] == 10
    db.close()
