"""Check canonical discovery identity, evidence retention and run facts."""

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from career_ops.discovery.store import DiscoveryStore

with tempfile.TemporaryDirectory() as temporary:
    store = DiscoveryStore(Path(temporary) / "opportunities.db")
    first = {"url": "https://example.com/a", "company": "Acme", "title": "Engineer",
             "description": "Build Python services", "fingerprint": ""}
    row = store.ingest(first, "fixture-api", observed_on="2026-09-28")
    assert row["url"] == first["url"]
    assert store.ingest(first, "fixture-api", observed_on="2026-09-28")["id"] == row["id"]
    alternate = {**first, "url": "https://example.com/b", "description": "Changed description"}
    assert store.ingest(alternate, "other-api", observed_on="2026-09-29")["id"] == row["id"]
    db = store.db
    assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 1
    assert db.execute("SELECT count(*) FROM source_evidence").fetchone()[0] == 2
    assert db.execute("SELECT count(*) FROM scan_observations").fetchone()[0] == 2
    assert db.execute("SELECT content FROM page_evidence").fetchone()[0] == first["description"]
    assert db.execute("SELECT count(*) FROM repost_inputs").fetchone()[0] == 0
    assert json.loads(db.execute("SELECT payload FROM source_evidence ORDER BY id").fetchone()[0])["description"] == first["description"]
    try:
        store.ingest({"url": "https://example.com/missing"}, "fixture-api")
    except ValueError:
        pass
    else:
        raise AssertionError("An unidentified opportunity was accepted")
    store.scan_outcome({"url": "https://example.com/dead", "company": "Acme"}, "skipped_expired")
    assert db.execute("SELECT status FROM scan_outcomes").fetchone()[0] == "skipped_expired"
    run = store.scan_run("configured", {"found": 2, "newAdded": 1}, [
        {"company": "Acme", "status": "reachable", "timestamp": "2026-09-28T00:00:00Z"}])
    assert run and db.execute("SELECT source FROM source_health WHERE scan_run_id=?", (run,)).fetchone()[0] == "Acme"
    replay = store.scan_run_once("configured", "graph-run", {"found": 1}, [
        {"company": "Acme", "status": "network", "timestamp": "2026-09-28T01:00:00Z"}])
    assert store.scan_run_once("configured", "graph-run", {"found": 1}, [
        {"company": "Acme", "status": "reachable", "timestamp": "2026-09-28T02:00:00Z"}]) == replay
    assert db.execute("SELECT count(*) FROM scan_runs WHERE run_id='graph-run'").fetchone()[0] == 1
    assert tuple(db.execute("SELECT status,checked_at FROM source_health WHERE scan_run_id=?", (replay,)).fetchone()) == (
        "reachable", "2026-09-28T02:00:00Z")
    for status in ("network", "auth"):
        store.scan_run("configured", {}, [{"company": "Failing", "status": status, "timestamp": "2026-09-28T03:00:00Z"}])
    assert store.health_streaks([{"company": "Failing", "status": "server"}]) == {"Acme": 0, "Failing": 3}
    store.scan_run("configured", {}, [{"company": "Failing", "status": "empty", "timestamp": "2026-09-28T04:00:00Z"}])
    assert store.health_streaks([{"company": "Failing", "status": "network"}]) == {"Acme": 0, "Failing": 1}
    store.close()

with tempfile.TemporaryDirectory() as temporary:
    path = Path(temporary) / "legacy.db"
    legacy = sqlite3.connect(path)
    legacy.execute("CREATE TABLE opportunities(id INTEGER PRIMARY KEY,url TEXT UNIQUE,company TEXT,role TEXT,source TEXT,state TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)")
    legacy.execute("CREATE TABLE scan_runs(id INTEGER PRIMARY KEY,operation TEXT NOT NULL,summary TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)")
    legacy.execute("INSERT INTO opportunities(url,company,role,source,state) VALUES('https://example.com/old','Acme','Engineer','legacy','discovered')")
    legacy.commit()
    legacy.close()
    upgraded = DiscoveryStore(path)
    assert tuple(upgraded.db.execute("SELECT identity,application_state,attempts FROM opportunities").fetchone()) == (
        "acme::engineer", "none", 0)
    assert "run_id" in {column["name"] for column in upgraded.db.execute("PRAGMA table_info(scan_runs)")}
    upgraded.close()
