"""Verify the read-only dashboard stages, materials and file boundary."""

import hashlib
import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
from urllib.error import HTTPError
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from career_ops.dashboard.actions import PrepareRunner  # noqa: E402
from career_ops.dashboard.server import handler_for  # noqa: E402


class StubRunner:
    def __init__(self):
        self.started = []

    def start(self, opportunity_id: int) -> dict:
        self.started.append(opportunity_id)
        return {"status": "running"}

    def status(self, opportunity_id: int) -> dict | None:
        return {"status": "running"} if opportunity_id in self.started else None

    def statuses(self) -> dict[int, str]:
        return {key: "running" for key in self.started}


def fetch(base: str, path: str, status: int = 200, method: str = "GET", headers: dict | None = None):
    try:
        with urlopen(Request(base + path, method=method, headers=headers or {})) as response:
            assert response.status == status, (path, response.status)
            body = response.read()
            return json.loads(body) if "json" in response.headers["Content-Type"] else body.decode()
    except HTTPError as error:
        assert error.code == status, (path, error.code)
        return json.loads(error.read())


with tempfile.TemporaryDirectory() as temporary:
    directory = Path(temporary)
    package = directory / "package-v001"
    package.mkdir()
    (package / "upskill.md").write_text("# Upskill\n\nLearn **evals**.")
    (package / "interview-prep.md").write_text("# Prep")
    (directory / "secret.md").write_text("not referenced")
    score = {"direction": 5, "compensation": None, "company": 4}
    prescreen = {"status": "pass"}
    database = directory / "opportunities.db"
    db = sqlite3.connect(database)
    db.executescript(
        """
        CREATE TABLE opportunities(id INTEGER PRIMARY KEY,url TEXT,company TEXT,role TEXT,source TEXT,state TEXT,application_state TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE tasks(task_id TEXT PRIMARY KEY,opportunity_id TEXT,module TEXT,status TEXT,input_hash TEXT,attempt INTEGER,waiting_reason TEXT,workflow_version TEXT,input_payload TEXT);
        CREATE TABLE results(result_key TEXT PRIMARY KEY,task_id TEXT UNIQUE,opportunity_id TEXT,module TEXT,input_hash TEXT,payload TEXT);
        CREATE TABLE drafts(task_id TEXT,version INTEGER,input_hash TEXT,package_hash TEXT,payload TEXT,PRIMARY KEY(task_id,version));
        CREATE TABLE eligibility(opportunity_id INTEGER PRIMARY KEY,status TEXT,evidence TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE evaluations(opportunity_id INTEGER PRIMARY KEY,lower_score REAL,upper_score REAL,coverage REAL,dimension_scores TEXT,report_hash TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE artifacts(id INTEGER PRIMARY KEY,opportunity_id INTEGER,kind TEXT,path TEXT,sha256 TEXT);
        CREATE TABLE application_lifecycle(opportunity_id TEXT PRIMARY KEY,status TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE application_events(id INTEGER PRIMARY KEY,operation_id TEXT,opportunity_id TEXT,from_status TEXT,to_status TEXT,action TEXT,source TEXT,payload TEXT,package_result_key TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO opportunities(id,url,company,role,source,state,application_state) VALUES
          (1,'https://example.com/1','Acme','Scanned Engineer','search','discovered','none'),
          (2,'https://example.com/2','Beta','Scored Engineer','provider','evaluated','none'),
          (3,'https://example.com/3','Gamma','Applied Engineer','provider','evaluated','submitted');
        INSERT INTO application_lifecycle(opportunity_id,status) VALUES('3','applied');
        INSERT INTO application_events(operation_id,opportunity_id,to_status,action,source,payload) VALUES('op','3','applied','submit','user','{"notes":"ok"}');
        INSERT INTO evaluations(opportunity_id,report_hash) VALUES(2,'h'),(3,'h');
        INSERT INTO eligibility(opportunity_id,status,evidence) VALUES(3,'pass','{"evidence":[]}');
        """
    )
    scan = {"outcome": "jd_report", "input_hash": "h", "artifact": {"jd": "JD text", "location_evidence": "Shanghai", "liveness": "active", "prescreen": prescreen}}
    scored = {"outcome": "score", "input_hash": "h", "artifact": {"report": "## A. 岗位概览\n\nGood fit", "score": score}}
    for opportunity in ("1", "2", "3"):
        db.execute("INSERT INTO results VALUES(?,?,?,?,?,?)", (f"scan-{opportunity}", f"scan-{opportunity}", opportunity, "scan", "h", json.dumps(scan)))
    for opportunity in ("2", "3"):
        db.execute("INSERT INTO results VALUES(?,?,?,?,?,?)", (f"score-{opportunity}", f"score-{opportunity}", opportunity, "score", "h", json.dumps(scored)))
    db.execute("INSERT INTO tasks VALUES('apply-3','3','apply','waiting','h',1,'user_review','v','{}')")
    db.execute("INSERT INTO drafts VALUES('apply-3',1,'h','p',?)", (json.dumps({"files": {
        "upskill": str(package / "upskill.md"), "interview_prep": str(package / "interview-prep.md"),
        "resume_pdf": str(package / "missing.pdf")}}),))
    db.commit()
    db.close()
    before = hashlib.sha256(database.read_bytes()).hexdigest()

    runner = StubRunner()
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(database, runner))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        assert "<title>Career Ops Dashboard</title>" in fetch(base, "/")
        jobs = {job["id"]: job for job in fetch(base, "/api/jobs")}
        assert [jobs[i]["stage"] for i in (1, 2, 3)] == ["scanned", "scored", "applied"]
        assert jobs[2]["score"] == 4.5 and jobs[2]["action"] == "focus" and jobs[1]["score"] is None
        assert jobs[3]["application_status"] == "applied" and jobs[3]["material_count"] == 1
        assert jobs[3]["url"] == "https://example.com/3" and jobs[1]["location"] == "Shanghai"

        detail = fetch(base, "/api/jobs/3")
        assert detail["report"].startswith("## A.") and detail["jd"] == "JD text"
        assert detail["application_events"][0]["payload"] == {"notes": "ok"}
        materials = {item["key"]: item for item in detail["materials"]}
        assert materials["upskill"]["content"].startswith("# Upskill") and materials["upskill"]["package"] == "draft v1"
        assert not materials["resume_pdf"]["exists"] and "path" not in materials["upskill"]

        upskill_id = materials["upskill"]["id"]
        assert "Learn **evals**" in fetch(base, f"/api/jobs/3/file?id={upskill_id}")
        fetch(base, f"/api/jobs/2/file?id={upskill_id}", 404)
        fetch(base, f"/api/jobs/3/file?id={materials['resume_pdf']['id']}", 404)
        fetch(base, "/api/jobs/3/file?id=" + str(directory / "secret.md"), 404)
        fetch(base, "/api/jobs/99", 404)

        action = {"X-Career-Ops": "dashboard"}
        fetch(base, "/api/jobs/2/prepare", 403, "POST")
        fetch(base, "/api/jobs/2/prepare", 403, "POST", {**action, "Origin": "https://evil.example"})
        fetch(base, "/api/jobs/2/prepare", 403, "POST", {**action, "Host": "evil.example"})
        fetch(base, "/api/jobs/1/prepare", 409, "POST", action)
        fetch(base, "/api/jobs/99/prepare", 404, "POST", action)
        assert runner.started == []
        origin = {**action, "Origin": base}
        assert fetch(base, "/api/jobs/2/prepare", 202, "POST", origin)["run"]["status"] == "running"
        assert runner.started == [2] and fetch(base, "/api/jobs/2/prepare")["run"]["status"] == "running"
        assert {job["id"]: job["prepare_status"] for job in fetch(base, "/api/jobs")} == {1: None, 2: "running", 3: None}
        assert fetch(base, "/api/jobs/3")["apply_task"] == {"task_id": "apply-3", "status": "waiting", "reason": "user_review"}
    finally:
        server.shutdown()
        server.server_close()
    assert hashlib.sha256(database.read_bytes()).hexdigest() == before, "dashboard must not write the store"

    # The real runner delegates to the CLI; the fixture inputs are incomplete, so it fails before any task or model call.
    real = PrepareRunner(directory)
    assert real.start(2)["status"] == "running"
    try:
        real.start(2)
        raise AssertionError("duplicate preparation must be refused")
    except RuntimeError:
        pass
    deadline = time.monotonic() + 60
    while real.status(2)["status"] == "running" and time.monotonic() < deadline:
        time.sleep(0.2)
    finished = real.status(2)
    assert finished["status"] == "failed" and finished["finished_at"], finished
    assert "ValueError" in finished["error"], finished["error"]
    with sqlite3.connect(database) as check:
        assert check.execute("SELECT COUNT(*) FROM tasks WHERE opportunity_id='2'").fetchone()[0] == 0

print("workflow dashboard: ok")
