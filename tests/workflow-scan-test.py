"""Verify scan evidence retention, deduplication, and score handoff."""

import json
import hashlib
import os
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / "workflow" / ".venv" / "bin" / "python"
CLI = ROOT / "workflow" / "career_ops.py"
RUNNER = f"{PYTHON} {ROOT / 'tests' / 'fixtures' / 'workflow-model-runner.py'}"
sys.path.insert(0, str(ROOT))
from workflow.career_ops import BusinessStore, canonical_scan_input, cron_score, scan_discovered, score_inputs


BUSINESS_RESULTS = """
CREATE TABLE eligibility (opportunity_id INTEGER PRIMARY KEY,status TEXT NOT NULL,evidence TEXT NOT NULL);
CREATE TABLE evaluations (opportunity_id INTEGER PRIMARY KEY,lower_score REAL NOT NULL,
  upper_score REAL NOT NULL,coverage REAL NOT NULL,report_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE artifacts (opportunity_id INTEGER NOT NULL,kind TEXT NOT NULL,path TEXT NOT NULL,
  sha256 TEXT NOT NULL,UNIQUE(opportunity_id,kind,path));
CREATE TABLE opportunity_events (opportunity_id INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE checkpoints (opportunity_id INTEGER NOT NULL,phase TEXT NOT NULL,input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,PRIMARY KEY(opportunity_id,phase));
CREATE TRIGGER eligibility_requires_evaluating BEFORE INSERT ON eligibility
  WHEN (SELECT state FROM opportunities WHERE id=NEW.opportunity_id)!='evaluating'
  BEGIN SELECT RAISE(ABORT,'eligibility requires evaluating opportunity'); END;
CREATE TRIGGER evaluation_requires_eligible BEFORE INSERT ON evaluations
  WHEN (SELECT state FROM opportunities WHERE id=NEW.opportunity_id)!='eligible'
  BEGIN SELECT RAISE(ABORT,'evaluation requires eligible opportunity'); END;
CREATE TRIGGER artifact_requires_evaluated BEFORE INSERT ON artifacts
  WHEN (SELECT state FROM opportunities WHERE id=NEW.opportunity_id)!='evaluated'
  BEGIN SELECT RAISE(ABORT,'artifact requires evaluated opportunity'); END;
"""


def run(directory: Path, *args: str) -> dict:
    result = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), *args],
        text=True, capture_output=True,
        env={**os.environ, "CAREER_OPS_MODEL_RUNNER": RUNNER},
    )
    assert result.returncode == 0, (args, result.stdout, result.stderr)
    return json.loads(result.stdout)


def capture_payload(url: str, jd: str) -> str:
    return json.dumps({"_capture": {
        "method": "workday_cxs_api", "status": 200, "url": url,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "content_hash": hashlib.sha256(jd.encode()).hexdigest(),
    }})


with tempfile.TemporaryDirectory(prefix="career-ops-scan-") as temporary:
    directory = Path(temporary)
    source = directory / "source.json"
    source.write_text(json.dumps({
        "schema_version": "scan_input_v1",
        "opportunity_id": "job-1",
        "url": "https://example.com/jobs/1",
        "company": "Example",
        "role": "AI Engineer",
        "captured_at": "2026-09-20T04:00:00Z",
        "liveness": "active",
        "jd": "Build and review agent workflows as an employee in Shanghai.",
    }))

    scanned = run(directory, "start", "scan", "job-1", str(source))
    assert scanned["status"] == "completed"
    assert scanned["artifact"]["artifact"]["schema_version"] == "jd_report_v1"
    assert "review" not in scanned["artifact"]
    assert run(directory, "start", "scan", "job-1", str(source)) == scanned

    inline = run(directory, "start", "scan", "inline", json.dumps({
        **json.loads(source.read_text()), "opportunity_id": "inline", "jd": "x" * 5000,
    }))
    assert inline["status"] == "completed"
    invalid_envelope = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "scan", "inline", json.dumps({"source": json.loads(source.read_text())})],
        text=True, capture_output=True,
    )
    assert invalid_envelope.returncode == 1 and "not a workflow envelope" in invalid_envelope.stderr
    invalid_liveness = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "scan", "inline", json.dumps({**json.loads(source.read_text()), "liveness": "closed"})],
        text=True, capture_output=True,
    )
    assert invalid_liveness.returncode == 1 and "JD or liveness is invalid" in invalid_liveness.stderr

    database = sqlite3.connect(directory / "opportunities.db")
    assert database.execute("SELECT count(*) FROM workflow_source_evidence").fetchone()[0] == 2
    database.close()

    scored = run(directory, "start", "score", "job-1", "scan:job-1")
    assert scored["status"] == "completed"
    assert scored["artifact"]["outcome"] == "score"
    missing = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "score", "missing", "scan:missing"],
        text=True, capture_output=True,
    )
    assert missing.returncode == 1 and "Missing completed scan result" in missing.stderr

    blocked = directory / "blocked.json"
    blocked.write_text(json.dumps({
        **json.loads(source.read_text()),
        "opportunity_id": "job-2",
        "url": "https://example.com/jobs/2",
        "liveness": "uncertain",
        "jd": "Access denied",
    }))
    waiting = run(directory, "start", "scan", "job-2", str(blocked))
    assert waiting["status"] == "waiting"
    assert waiting["reason"] == "source_access_unknown"
    recovered_source = directory / "recovered.json"
    recovered_source.write_text(json.dumps({
        **json.loads(blocked.read_text()),
        "captured_at": "2026-09-20T04:10:00Z",
        "liveness": "active",
        "jd": "Build agent workflows as a full-time employee.",
    }))
    recovered = run(directory, "resume", waiting["task_id"], "--input", str(recovered_source))
    assert recovered["status"] == "completed" and recovered["attempt"] == 2

    crash_source = directory / "crash.json"
    crash_source.write_text(json.dumps({
        **json.loads(source.read_text()),
        "opportunity_id": "job-3",
        "url": "https://example.com/jobs/3",
    }))
    crashed = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "scan", "job-3", str(crash_source), "--crash-at", "publish"],
        text=True, capture_output=True, env={**os.environ, "CAREER_OPS_MODEL_RUNNER": RUNNER},
    )
    assert crashed.returncode == 86
    crashed_task = next(task for task in run(directory, "list") if task["opportunity_id"] == "job-3")
    recovered_crash = run(directory, "run", crashed_task["task_id"], "--crash-at", "publish")
    assert recovered_crash["status"] == "completed"

    excluded_source = directory / "excluded.json"
    excluded_source.write_text(json.dumps({
        **json.loads(source.read_text()),
        "opportunity_id": "job-4",
        "url": "https://example.com/jobs/4",
        "test_exclude": True,
    }))
    excluded = run(directory, "start", "scan", "job-4", str(excluded_source))
    assert excluded["artifact"]["outcome"] == "exclude"

with tempfile.TemporaryDirectory(prefix="career-ops-active-") as temporary:
    store = BusinessStore(Path(temporary) / "opportunities.db")
    active = store.start("job", "scan", "original")
    assert store.start("job", "scan", "original")["task_id"] == active["task_id"]
    for module, payload in (("score", "different module"), ("scan", "changed input")):
        try:
            store.start("job", module, payload)
        except ValueError as error:
            assert "owns this opportunity" in str(error)
        else:
            raise AssertionError("An active task silently captured another request")
    store.close()

with tempfile.TemporaryDirectory(prefix="career-ops-cron-") as temporary:
    directory = Path(temporary)
    database = sqlite3.connect(directory / "opportunities.db")
    database.executescript("""
      CREATE TABLE opportunities (
        id INTEGER PRIMARY KEY, url TEXT NOT NULL, company TEXT NOT NULL,
        role TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'discovered',
        claimed_by TEXT, attempts INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE page_evidence (
        opportunity_id INTEGER PRIMARY KEY, content TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE TABLE source_evidence (id INTEGER PRIMARY KEY, opportunity_id INTEGER, payload TEXT NOT NULL);
      INSERT INTO opportunities(id,url,company,role) VALUES
        (1,'https://example.com/jobs/cron','Example','AI Engineer');
      INSERT INTO page_evidence(opportunity_id,content,captured_at) VALUES
        (1,'Build reviewed AI agent workflows.','2026-09-20T04:00:00Z');
    """)
    database.execute("INSERT INTO source_evidence(opportunity_id,payload) VALUES(1,?)", (
        capture_payload("https://example.com/jobs/cron", "Build reviewed AI agent workflows."),
    ))
    database.executescript(BUSINESS_RESULTS)
    database.commit()
    database.close()
    assert run(directory, "cron-score")["task"]["status"] == "completed"
    score_crash = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(directory), "start", "score", "1", "scan:1", "--crash-at", "publish"],
        text=True, capture_output=True, env={**os.environ, "CAREER_OPS_MODEL_RUNNER": RUNNER},
    )
    assert score_crash.returncode == 86
    crashed_score = next(task for task in run(directory, "list") if task["opportunity_id"] == "1" and task["module"] == "score")
    assert run(directory, "run", crashed_score["task_id"], "--crash-at", "publish")["status"] == "completed"
    assert run(directory, "cron-score") == {"status": "idle", "reason": "no_unscored_opportunities"}
    database = sqlite3.connect(directory / "opportunities.db")
    assert database.execute("SELECT state FROM opportunities WHERE id=1").fetchone()[0] == "evaluated"
    assert database.execute("SELECT count(*) FROM evaluations WHERE opportunity_id=1").fetchone()[0] == 1
    assert database.execute("SELECT count(*) FROM artifacts WHERE opportunity_id=1 AND kind='report'").fetchone()[0] == 1
    assert database.execute("SELECT count(*) FROM checkpoints WHERE opportunity_id=1 AND phase='publish'").fetchone()[0] == 1
    assert database.execute("SELECT count(*) FROM opportunity_events WHERE opportunity_id=1 AND type='published'").fetchone()[0] == 1
    database.close()

with tempfile.TemporaryDirectory(prefix="career-ops-cron-wait-") as temporary:
    directory = Path(temporary)
    database = sqlite3.connect(directory / "opportunities.db")
    database.executescript("""
      CREATE TABLE opportunities (id INTEGER PRIMARY KEY, url TEXT NOT NULL, company TEXT NOT NULL, role TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'discovered', claimed_by TEXT, attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE page_evidence (opportunity_id INTEGER PRIMARY KEY, content TEXT NOT NULL, captured_at TEXT NOT NULL);
      CREATE TABLE source_evidence (id INTEGER PRIMARY KEY, opportunity_id INTEGER, payload TEXT NOT NULL);
      INSERT INTO opportunities(id,url,company,role) VALUES (1,'https://example.com/jobs/blocked','Blocked','Engineer');
      INSERT INTO opportunities(id,url,company,role) VALUES (2,'https://example.com/jobs/ready','Ready','Engineer');
      INSERT INTO page_evidence VALUES (2,'Build reviewed AI systems.','2026-09-20T04:00:00Z');
      INSERT INTO page_evidence VALUES (1,'Old JD text alone is not liveness evidence.','2026-09-20T04:00:00Z');
    """)
    database.execute("INSERT INTO source_evidence(opportunity_id,payload) VALUES(2,?)", (
        capture_payload("https://example.com/jobs/ready", "Build reviewed AI systems."),
    ))
    database.executescript(BUSINESS_RESULTS)
    database.commit()
    database.close()
    assert run(directory, "cron-score")["task"]["status"] == "waiting"
    advanced = run(directory, "cron-score")
    assert advanced["opportunity_id"] == "2" and advanced["task"]["status"] == "completed"
    assert run(directory, "cron-score")["opportunity_id"] == "2"
    blocked_task = next(task for task in run(directory, "list") if task["opportunity_id"] == "1")
    refreshed = {
        "status": "captured", "url": "https://example.com/jobs/blocked",
        "text": "Build reviewed AI agent workflows in Shanghai as an employee.",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }
    with patch("workflow.career_ops.capture_jd", return_value=None), patch.dict(os.environ, {"CAREER_OPS_MODEL_RUNNER": RUNNER}):
        assert cron_score(directory)["status"] == "waiting"
    with patch("workflow.career_ops.capture_jd", return_value=refreshed), patch.dict(os.environ, {"CAREER_OPS_MODEL_RUNNER": RUNNER}):
        recovered = cron_score(directory)
    assert recovered["opportunity_id"] == "1"
    assert recovered["task"]["task_id"] == blocked_task["task_id"]
    assert recovered["task"]["status"] == "completed"

with tempfile.TemporaryDirectory(prefix="career-ops-cron-fair-") as temporary:
    directory = Path(temporary)
    database = sqlite3.connect(directory / "opportunities.db")
    database.executescript("""
      CREATE TABLE opportunities (id INTEGER PRIMARY KEY, url TEXT NOT NULL, company TEXT NOT NULL, role TEXT NOT NULL);
      CREATE TABLE page_evidence (opportunity_id INTEGER PRIMARY KEY, content TEXT NOT NULL, captured_at TEXT NOT NULL);
      INSERT INTO opportunities VALUES (1,'https://example.com/jobs/one','One','Engineer');
      INSERT INTO opportunities VALUES (2,'https://example.com/jobs/two','Two','Engineer');
    """)
    database.close()
    with patch("workflow.career_ops.capture_jd", return_value=None), patch.dict(os.environ, {"CAREER_OPS_MODEL_RUNNER": RUNNER}):
        assert cron_score(directory)["opportunity_id"] == "1"
        assert cron_score(directory)["opportunity_id"] == "2"
        assert cron_score(directory)["opportunity_id"] == "1"
        assert cron_score(directory)["opportunity_id"] == "2"
    waiting = next(task for task in run(directory, "list") if task["opportunity_id"] == "2")
    refreshed = {
        "status": "captured", "url": "https://example.com/jobs/two",
        "text": "Build reviewed AI agent workflows in Shanghai as an employee.",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }
    with patch("workflow.career_ops.capture_jd", return_value=refreshed), patch.dict(os.environ, {"CAREER_OPS_MODEL_RUNNER": RUNNER}):
        assert scan_discovered(directory, "2")["task_id"] == waiting["task_id"]

with tempfile.TemporaryDirectory(prefix="career-ops-cron-retry-") as temporary:
    directory = Path(temporary)
    database = sqlite3.connect(directory / "opportunities.db")
    database.executescript("""
      CREATE TABLE opportunities (id INTEGER PRIMARY KEY, url TEXT NOT NULL, company TEXT NOT NULL, role TEXT NOT NULL);
      CREATE TABLE page_evidence (opportunity_id INTEGER PRIMARY KEY, content TEXT NOT NULL, captured_at TEXT NOT NULL);
      INSERT INTO opportunities VALUES (1,'https://example.com/jobs/failed','Failed','Engineer');
      INSERT INTO opportunities VALUES (2,'https://example.com/jobs/fresh','Fresh','Engineer');
    """)
    database.close()
    store = BusinessStore(directory / "opportunities.db")
    failed = store.start("1", "scan", "{}")
    store.wait(failed["task_id"], "failure:RuntimeError")
    store.close()
    with patch("workflow.career_ops.current_discovered_scan_source", return_value={"jd": "fixture"}), \
         patch("workflow.career_ops.start_and_run", return_value={"status": "completed"}) as start:
        assert cron_score(directory)["opportunity_id"] == "2"
        assert start.call_args.args[1] == "2"
    database = sqlite3.connect(directory / "opportunities.db")
    database.execute("DELETE FROM opportunities WHERE id=2")
    database.commit()
    database.close()
    with patch("workflow.career_ops.resume_task", return_value={"status": "completed"}) as resume:
        assert cron_score(directory)["opportunity_id"] == "1"
        assert resume.call_args.args == (directory, failed["task_id"], None, None)
    database = sqlite3.connect(directory / "opportunities.db")
    database.execute("UPDATE tasks SET attempt=2 WHERE task_id=?", (failed["task_id"],))
    database.commit()
    database.close()
    assert cron_score(directory) == {"status": "idle", "reason": "no_unscored_opportunities"}

with tempfile.TemporaryDirectory(prefix="career-ops-cron-stale-") as temporary:
    directory = Path(temporary)
    database = sqlite3.connect(directory / "opportunities.db")
    database.executescript("""
      CREATE TABLE opportunities (id INTEGER PRIMARY KEY, url TEXT NOT NULL, company TEXT NOT NULL, role TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'discovered', claimed_by TEXT, attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE page_evidence (opportunity_id INTEGER PRIMARY KEY, content TEXT NOT NULL, captured_at TEXT NOT NULL);
      CREATE TABLE opportunity_events (opportunity_id INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL);
      INSERT INTO opportunities(id,url,company,role) VALUES (1,'https://example.com/jobs/stale','Stale','Engineer');
    """)
    database.close()
    store = BusinessStore(directory / "opportunities.db")
    report = {"schema_version": "jd_report_v1", "opportunity_id": "1", "url": "https://example.com/jobs/stale",
              "company": "Stale", "role": "Engineer", "jd": "Build reviewed systems.",
              "captured_at": "2026-09-29T00:00:00Z", "liveness": "active", "prescreen": {"status": "uncertain"}}
    scanned = store.start("1", "scan", "{}")
    store.db.execute("UPDATE tasks SET status='completed' WHERE task_id=?", (scanned["task_id"],))
    store.db.execute("INSERT INTO results(result_key,task_id,opportunity_id,module,input_hash,payload) VALUES(?,?,?,?,?,?)",
                     (scanned["task_id"], scanned["task_id"], "1", "scan", "old-scan", json.dumps({"outcome": "jd_report", "artifact": report})))
    scored = store.start("1", "score", json.dumps({"jd_report": report}))
    store.db.execute("UPDATE tasks SET status='completed' WHERE task_id=?", (scored["task_id"],))
    store.db.execute("INSERT INTO results(result_key,task_id,opportunity_id,module,input_hash,payload) VALUES(?,?,?,?,?,?)",
                     (scored["task_id"], scored["task_id"], "1", "score", store.task(scored["task_id"])["input_hash"],
                      json.dumps({"outcome": "score", "artifact": {"score": {"lower": 2, "upper": 4, "coverage": 0.5}}})))
    store.close()
    with patch("workflow.career_ops.start_and_run", return_value={"status": "completed"}) as start:
        assert cron_score(directory)["opportunity_id"] == "1"
        assert start.call_args.args == (directory, "1", "score", "scan:1", None, True)
    store = BusinessStore(directory / "opportunities.db")
    current_input = score_inputs(report)
    current_hash = hashlib.sha256(current_input.encode()).hexdigest()
    store.db.execute("UPDATE tasks SET input_hash=?,input_payload=? WHERE task_id=?",
                     (current_hash, current_input, scored["task_id"]))
    store.db.execute("UPDATE results SET input_hash=? WHERE task_id=?", (current_hash, scored["task_id"]))
    assert store.score_views()[0]["valid"] is True
    store.db.execute("UPDATE results SET payload=? WHERE task_id=?",
                     (json.dumps({"outcome": "jd_report", "artifact": {**report, "jd": "Changed current JD."}}), scanned["task_id"]))
    assert store.score_views()[0]["stale_reason"] == "candidate_or_policy_inputs_changed"
    pending = store.start("1", "score", "new-input", re_evaluate=True)
    store.wait(pending["task_id"], "user_deferred")
    store.close()
    assert cron_score(directory) == {"status": "idle", "reason": "no_unscored_opportunities"}

with tempfile.TemporaryDirectory(prefix="career-ops-cron-rescanned-") as temporary:
    directory = Path(temporary)
    database = sqlite3.connect(directory / "opportunities.db")
    database.executescript("""
      CREATE TABLE opportunities (id INTEGER PRIMARY KEY, url TEXT NOT NULL, company TEXT NOT NULL, role TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'discovered', claimed_by TEXT, attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE page_evidence (opportunity_id INTEGER PRIMARY KEY, content TEXT NOT NULL, captured_at TEXT NOT NULL);
      CREATE TABLE opportunity_events (opportunity_id INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL);
      INSERT INTO opportunities(id,url,company,role) VALUES (1,'https://example.com/jobs/recovered','Recovered','Engineer');
    """)
    database.close()
    store = BusinessStore(directory / "opportunities.db")
    for source, outcome in (("old", "exclude"), ("new", "jd_report")):
        task = store.start("1", "scan", source, re_evaluate=True)
        store.db.execute("UPDATE tasks SET status='completed' WHERE task_id=?", (task["task_id"],))
        store.db.execute("INSERT INTO results(result_key,task_id,opportunity_id,module,input_hash,payload) VALUES(?,?,?,?,?,?)",
                         (task["task_id"], task["task_id"], "1", "scan", source,
                          json.dumps({"outcome": outcome, "artifact": {}})))
    store.close()
    with patch("workflow.career_ops.start_and_run", return_value={"status": "completed"}) as start:
        assert cron_score(directory)["opportunity_id"] == "1"
        assert start.call_args.args == (directory, "1", "score", "scan:1", None)
    scan_input = {"schema_version": "scan_input_v1", "opportunity_id": "1",
                  "url": "https://example.com/jobs/recovered", "company": "Recovered",
                  "role": "Engineer", "jd": "Build systems.",
                  "captured_at": "2026-09-29T00:00:00Z", "liveness": "active"}
    assert json.loads(canonical_scan_input(json.dumps(scan_input)))["scan_policy_version"] == 2

print("workflow scan: evidence, deduplication, and score handoff passed")
