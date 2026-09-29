"""Check company response and posting evidence labels over canonical events."""

import sqlite3
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from workflow.insights.company import company_view, company_signals


with tempfile.TemporaryDirectory() as temp:
    portals = Path(temp) / "portals.yml"
    portals.write_text("job_boards:\n  - name: Board\n    aggregator: true\n  - name: Joinup.ch\n    aggregator: true\n")
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    missing = company_view(db, portals)
    assert missing["status"] == "source_missing"
    assert missing["companies"][0]["postingChurn"]["label"] == "no-scan-data"
    assert any(card["company"] == "Joinup.ch" for card in missing["companies"])
    assert company_view(db, portals, company="Unknown")["companies"][0]["responsiveness"]["label"] == "no-history"
    scan_only = sqlite3.connect(":memory:")
    scan_only.row_factory = sqlite3.Row
    scan_only.executescript("""
        CREATE TABLE scan_observations(id INTEGER PRIMARY KEY,url TEXT,company TEXT,title TEXT,observed_on TEXT);
        INSERT INTO scan_observations(url,company,title,observed_on) VALUES
            ('a','Acme','Engineer','2026-01-01'),('b','Acme','Engineer','2026-02-01');
    """)
    scanned = company_view(scan_only, portals)
    assert scanned["status"] == "partial"
    assert scanned["companies"][0]["responsiveness"]["label"] == "no-history"
    assert scanned["companies"][0]["postingChurn"]["label"] == "reposts-detected"
    unknown = company_view(scan_only, portals, company="Unknown")["companies"][0]
    assert unknown["responsiveness"]["label"] == "no-history"
    assert unknown["postingChurn"]["label"] == "none-detected"
    scan_only.close()
    db.executescript("""
        CREATE TABLE opportunities(id INTEGER PRIMARY KEY,company TEXT,created_at TEXT);
        CREATE TABLE application_lifecycle(opportunity_id TEXT,status TEXT);
        CREATE TABLE application_events(id INTEGER PRIMARY KEY,opportunity_id TEXT,to_status TEXT,payload TEXT,created_at TEXT);
        CREATE TABLE application_activity(opportunity_id TEXT,type TEXT);
        CREATE TABLE scan_observations(id INTEGER PRIMARY KEY,url TEXT,company TEXT,title TEXT,observed_on TEXT);
        INSERT INTO opportunities VALUES(1,'Acme','2026-01-01'),(2,'Acme','2026-01-01'),
            (3,'Beta','2026-03-15'),(4,'Gamma','2024-01-01');
        INSERT INTO application_lifecycle VALUES('1','applied'),('2','rejected'),('3','applied'),('4','applied');
        INSERT INTO application_events(opportunity_id,to_status,payload,created_at) VALUES
            ('1','applied','{"submitted_at":"2026-01-01"}','2026-03-20'),
            ('2','applied','{}','2026-01-01'),('2','rejected','{}','2026-01-15'),
            ('3','applied','{}','2026-03-15'),('4','applied','{}','2024-01-01');
        INSERT INTO application_activity VALUES('1','followup_sent');
        INSERT INTO scan_observations(url,company,title,observed_on) VALUES
            ('a','Acme','Engineer','2026-01-01'),('b','Acme','Engineer','2026-02-01');
    """)
    result = company_view(db, portals, today=date(2026, 4, 1))
    cards = {item["key"]: item for item in result["companies"]}
    assert cards["acme"]["responsiveness"]["label"] == "mixed"
    assert cards["acme"]["responsiveness"]["facts"][0]["confidence"] == "confirmed-by-followups"
    assert cards["acme"]["responsiveness"]["facts"][0]["dateBasis"] == "submitted_at"
    assert cards["acme"]["postingChurn"]["label"] == "reposts-detected"
    assert cards["beta"]["responsiveness"]["label"] == "no-history"
    assert cards["gamma"]["responsiveness"]["label"] == "no-history"
    assert cards["gamma"]["responsiveness"]["facts"][0]["stale"]
    assert cards["board"]["postingChurn"]["label"] == "aggregator-not-evaluated"
    assert company_view(db, portals, today=date(2026, 4, 1), include_stale=True,
                        company="Gamma")["companies"][0]["responsiveness"]["label"] == "silent-on-you"
    profile = Path(temp) / "profile.yml"
    profile.write_text("location:\n  country: China\n")
    package = Path(temp) / "package.json"
    package.write_text('{"version":"1.2.3"}')
    gamma = company_view(db, portals, today=date(2026, 4, 1), include_stale=True, company="Gamma")
    signal = company_signals(gamma, profile, package, include_stale=True)["records"][0]
    assert signal["region"] == "asia/china" and signal["severity"] == "single"
    assert signal["observedAt"] == "2024-01" and signal["sourceHash"].startswith("sha256:")
    assert company_signals(gamma, Path(temp) / "missing.yml", package)["records"] == []
    db.execute("INSERT INTO opportunities VALUES(5,'Gamma','2025-01-01')")
    db.execute("INSERT INTO application_lifecycle VALUES('5','applied')")
    db.execute("INSERT INTO application_events(opportunity_id,to_status,payload,created_at) VALUES('5','applied','{\"via\":\"Agency\"}','2025-01-01')")
    later = company_view(db, portals, today=date(2026, 4, 1), include_stale=True, company="Gamma")
    next_signal = company_signals(later, profile, package, include_stale=True)["records"][0]
    assert next_signal["severity"] == "pattern" and next_signal["observedAt"] == "2025-01"
    assert next_signal["postingChannel"] == "staffing-agency"
