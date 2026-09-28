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
from workflow.career_ops import BusinessStore, cron_score, scan_discovered


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
        role TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'discovered'
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
    database.commit()
    database.close()
    assert run(directory, "cron-score")["task"]["status"] == "completed"
    assert run(directory, "cron-score")["task"]["status"] == "completed"
    assert run(directory, "cron-score") == {"status": "idle", "reason": "no_unscored_opportunities"}

with tempfile.TemporaryDirectory(prefix="career-ops-cron-wait-") as temporary:
    directory = Path(temporary)
    database = sqlite3.connect(directory / "opportunities.db")
    database.executescript("""
      CREATE TABLE opportunities (id INTEGER PRIMARY KEY, url TEXT NOT NULL, company TEXT NOT NULL, role TEXT NOT NULL);
      CREATE TABLE page_evidence (opportunity_id INTEGER PRIMARY KEY, content TEXT NOT NULL, captured_at TEXT NOT NULL);
      CREATE TABLE source_evidence (id INTEGER PRIMARY KEY, opportunity_id INTEGER, payload TEXT NOT NULL);
      INSERT INTO opportunities VALUES (1,'https://example.com/jobs/blocked','Blocked','Engineer');
      INSERT INTO opportunities VALUES (2,'https://example.com/jobs/ready','Ready','Engineer');
      INSERT INTO page_evidence VALUES (2,'Build reviewed AI systems.','2026-09-20T04:00:00Z');
      INSERT INTO page_evidence VALUES (1,'Old JD text alone is not liveness evidence.','2026-09-20T04:00:00Z');
    """)
    database.execute("INSERT INTO source_evidence(opportunity_id,payload) VALUES(2,?)", (
        capture_payload("https://example.com/jobs/ready", "Build reviewed AI systems."),
    ))
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

print("workflow scan: evidence, deduplication, and score handoff passed")
