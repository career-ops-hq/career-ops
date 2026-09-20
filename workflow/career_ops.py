"""Run the local LangGraph workflow behind the Career Ops JSON CLI."""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import shlex
import sqlite3
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Literal, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

os.environ.setdefault("LANGGRAPH_STRICT_MSGPACK", "true")

ROOT = Path(__file__).resolve().parents[1]
INPUT_ROOT = Path(os.environ.get("CAREER_OPS_INPUT_ROOT", ROOT))
WORKFLOW_VERSION = "oii-333-v1"
MAX_CORRECTIONS = 2
MODEL_RUNNER = ROOT / "workflow" / "model_runner.py"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def score_inputs(report: dict) -> str:
    """Bind a JD report to every module-level policy and candidate input."""
    required = {"schema_version", "opportunity_id", "url", "company", "role", "jd", "liveness", "prescreen"}
    missing = sorted(required - report.keys())
    if missing:
        raise ValueError("JD report missing: " + ", ".join(missing))
    if report["schema_version"] != "jd_report_v1":
        raise ValueError("Unsupported JD report schema")
    if report["liveness"] != "active" or not str(report["jd"]).strip():
        raise ValueError("A complete active JD report is required")
    inputs = {
        "jd_report": report,
        "cv": (INPUT_ROOT / "cv.md").read_text(),
        "profile": (INPUT_ROOT / "config" / "profile.yml").read_text(),
        "targeting": (INPUT_ROOT / "modes" / "_profile.md").read_text(),
        "rules": (INPUT_ROOT / "modes" / "_custom.md").read_text(),
    }
    return json.dumps(inputs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_score_input(value: str) -> str:
    path = Path(value)
    return score_inputs(json.loads(path.read_text())) if path.is_file() else value


def canonical_scan_input(value: str) -> str:
    path = Path(value)
    if not path.is_file():
        return value
    source = json.loads(path.read_text())
    required = {"schema_version", "opportunity_id", "url", "company", "role", "jd", "captured_at", "liveness"}
    missing = sorted(required - source.keys())
    if missing:
        raise ValueError("Scan input missing: " + ", ".join(missing))
    if source["schema_version"] != "scan_input_v1":
        raise ValueError("Unsupported scan input schema")
    inputs = {
        "source": source,
        "cv": (INPUT_ROOT / "cv.md").read_text(),
        "profile": (INPUT_ROOT / "config" / "profile.yml").read_text(),
        "targeting": (INPUT_ROOT / "modes" / "_profile.md").read_text(),
        "rules": (INPUT_ROOT / "modes" / "_custom.md").read_text(),
    }
    return json.dumps(inputs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def apply_inputs(jd_report: dict, score_result: dict, feedback: list[str]) -> str:
    score_inputs(jd_report)
    inputs = {
        "jd_report": jd_report,
        "score_result": score_result,
        "cv": (INPUT_ROOT / "cv.md").read_text(),
        "profile": (INPUT_ROOT / "config" / "profile.yml").read_text(),
        "targeting": (INPUT_ROOT / "modes" / "_profile.md").read_text(),
        "rules": (INPUT_ROOT / "modes" / "_custom.md").read_text(),
        "requirements": (INPUT_ROOT / "prompts" / "applications" / "workflow.md").read_text(),
        "feedback": feedback,
    }
    return json.dumps(inputs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def validate_resume_payload(payload: dict) -> None:
    if not payload.get("candidate", {}).get("name") or not isinstance(payload.get("summary"), str):
        raise ValueError("resume_payload requires candidate.name and summary")
    for entry in payload.get("experience", []):
        if not all(key in entry for key in ("company", "role", "dates", "bullets")) or not isinstance(entry["bullets"], list):
            raise ValueError("resume experience requires company, role, dates and bullets")
    for entry in payload.get("education", []):
        if not all(key in entry for key in ("org", "title", "year")):
            raise ValueError("resume education requires org, title and year")
    for entry in payload.get("projects", []):
        if "name" not in entry or not isinstance(entry.get("bullets", []), list):
            raise ValueError("resume projects require name and bullets")
    for entry in payload.get("skills", []):
        if "category" not in entry or "items" not in entry:
            raise ValueError("resume skills require category and items")


class WorkflowState(TypedDict):
    task_id: str
    module: Literal["scan", "score", "apply"]
    input_hash: str
    required_corrections: int
    revision: int
    outcome: Literal["jd_report", "score", "exclude", "package"]
    draft: str
    review_approved: bool
    review: dict
    waiting_reason: str | None
    material_hash: str
    tool_calls: int
    started_at: float


class BusinessStore:
    """Own task identity, input validity, active ownership and formal results."""

    def __init__(self, path: Path):
        self.db = sqlite3.connect(path, timeout=5, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        existing = self.db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
        ).fetchone()
        if existing and "'apply'" not in existing["sql"]:
            self.db.executescript(
                """
                PRAGMA foreign_keys=OFF;
                BEGIN IMMEDIATE;
                CREATE TABLE tasks_new (
                  task_id TEXT PRIMARY KEY,
                  opportunity_id TEXT NOT NULL,
                  module TEXT NOT NULL CHECK(module IN ('scan','score','apply')),
                  status TEXT NOT NULL CHECK(status IN ('running','waiting','completed','cancelled')),
                  input_hash TEXT NOT NULL,
                  attempt INTEGER NOT NULL DEFAULT 1,
                  waiting_reason TEXT,
                  workflow_version TEXT NOT NULL,
                  input_payload TEXT NOT NULL
                );
                INSERT INTO tasks_new SELECT * FROM tasks;
                DROP TABLE tasks;
                ALTER TABLE tasks_new RENAME TO tasks;
                COMMIT;
                PRAGMA foreign_keys=ON;
                """
            )
        self.db.executescript(
            """
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS tasks (
              task_id TEXT PRIMARY KEY,
              opportunity_id TEXT NOT NULL,
              module TEXT NOT NULL CHECK(module IN ('scan','score','apply')),
              status TEXT NOT NULL CHECK(status IN ('running','waiting','completed','cancelled')),
              input_hash TEXT NOT NULL,
              attempt INTEGER NOT NULL DEFAULT 1,
              waiting_reason TEXT,
              workflow_version TEXT NOT NULL,
              input_payload TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_task_per_opportunity
              ON tasks(opportunity_id) WHERE status IN ('running','waiting');
            CREATE TABLE IF NOT EXISTS results (
              result_key TEXT PRIMARY KEY,
              task_id TEXT NOT NULL UNIQUE REFERENCES tasks(task_id),
              opportunity_id TEXT NOT NULL,
              module TEXT NOT NULL,
              input_hash TEXT NOT NULL,
              payload TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_result_per_input
              ON results(opportunity_id,module,input_hash);
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY,
              task_id TEXT NOT NULL REFERENCES tasks(task_id),
              type TEXT NOT NULL,
              payload TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS source_evidence (
              source_hash TEXT PRIMARY KEY,
              opportunity_id TEXT NOT NULL,
              url TEXT NOT NULL,
              captured_at TEXT NOT NULL,
              payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS drafts (
              task_id TEXT NOT NULL REFERENCES tasks(task_id),
              version INTEGER NOT NULL,
              input_hash TEXT NOT NULL,
              package_hash TEXT NOT NULL,
              payload TEXT NOT NULL,
              review TEXT NOT NULL,
              approved INTEGER NOT NULL,
              PRIMARY KEY(task_id,version)
            );
            CREATE TABLE IF NOT EXISTS feedback (
              id INTEGER PRIMARY KEY,
              task_id TEXT NOT NULL REFERENCES tasks(task_id),
              text TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS task_context (
              task_id TEXT NOT NULL REFERENCES tasks(task_id),
              key TEXT NOT NULL,
              payload TEXT NOT NULL,
              PRIMARY KEY(task_id,key)
            );
            CREATE TABLE IF NOT EXISTS confirmations (
              task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
              input_hash TEXT NOT NULL,
              package_hash TEXT NOT NULL,
              confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )

    def close(self) -> None:
        self.db.close()

    def start(self, opportunity_id: str, module: str, input_text: str, *, re_evaluate: bool = False) -> dict:
        input_hash = digest(input_text)
        reused = self.db.execute(
            "SELECT task_id FROM results WHERE opportunity_id=? AND module=? AND input_hash=?",
            (opportunity_id, module, input_hash),
        ).fetchone()
        if reused:
            return {"task_id": reused["task_id"], "status": "completed", "reused": True}
        prior = self.db.execute(
            "SELECT task_id FROM results WHERE opportunity_id=? AND module=? LIMIT 1",
            (opportunity_id, module),
        ).fetchone()
        if prior and not re_evaluate:
            raise ValueError(f"A {module} result already exists; pass --re-evaluate for changed inputs")
        self.db.execute("BEGIN IMMEDIATE")
        try:
            active = self.db.execute(
                "SELECT task_id,status FROM tasks WHERE opportunity_id=? AND status IN ('running','waiting')",
                (opportunity_id,),
            ).fetchone()
            if active:
                self.db.execute("COMMIT")
                return {**dict(active), "reused": False}
            task_id = str(uuid.uuid4())
            self.db.execute(
                "INSERT INTO tasks(task_id,opportunity_id,module,status,input_hash,workflow_version,input_payload) VALUES(?,?,?,'running',?,?,?)",
                (task_id, opportunity_id, module, input_hash, WORKFLOW_VERSION, input_text),
            )
            self.db.execute("COMMIT")
            return {"task_id": task_id, "status": "running", "reused": False}
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    def task(self, task_id: str) -> sqlite3.Row:
        row = self.db.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        if not row:
            raise ValueError(f"Unknown task: {task_id}")
        return row

    def result(self, task_id: str) -> dict | None:
        row = self.db.execute("SELECT payload FROM results WHERE task_id=?", (task_id,)).fetchone()
        return json.loads(row["payload"]) if row else None

    def module_result(self, opportunity_id: str, module: str) -> dict | None:
        row = self.db.execute(
            "SELECT payload FROM results WHERE opportunity_id=? AND module=? ORDER BY rowid DESC LIMIT 1",
            (opportunity_id, module),
        ).fetchone()
        return json.loads(row["payload"]) if row else None

    def retain_source(self, opportunity_id: str, input_text: str) -> None:
        inputs = json.loads(input_text)
        source = inputs["source"]
        payload = json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        self.db.execute(
            "INSERT OR IGNORE INTO source_evidence(source_hash,opportunity_id,url,captured_at,payload) VALUES(?,?,?,?,?)",
            (digest(payload), opportunity_id, source["url"], source["captured_at"], payload),
        )

    def feedback(self, task_id: str) -> list[str]:
        return [row["text"] for row in self.db.execute(
            "SELECT text FROM feedback WHERE task_id=? ORDER BY id", (task_id,)
        )]

    def add_feedback(self, task_id: str, text: str) -> None:
        if not text.strip():
            raise ValueError("feedback cannot be empty")
        self.db.execute("INSERT INTO feedback(task_id,text) VALUES(?,?)", (task_id, text.strip()))

    def set_context(self, task_id: str, key: str, payload: dict) -> None:
        self.db.execute(
            "INSERT INTO task_context(task_id,key,payload) VALUES(?,?,?) ON CONFLICT(task_id,key) DO UPDATE SET payload=excluded.payload",
            (task_id, key, json.dumps(payload, ensure_ascii=False, sort_keys=True)),
        )

    def context(self, task_id: str, key: str) -> dict | None:
        row = self.db.execute(
            "SELECT payload FROM task_context WHERE task_id=? AND key=?", (task_id, key)
        ).fetchone()
        return json.loads(row["payload"]) if row else None

    def clear_context(self, task_id: str, key: str) -> None:
        self.db.execute("DELETE FROM task_context WHERE task_id=? AND key=?", (task_id, key))

    def draft(self, task_id: str) -> dict | None:
        row = self.db.execute(
            "SELECT * FROM drafts WHERE task_id=? ORDER BY version DESC LIMIT 1", (task_id,)
        ).fetchone()
        if not row:
            return None
        return {
            **json.loads(row["payload"]),
            "version": row["version"],
            "package_hash": row["package_hash"],
            "input_hash": row["input_hash"],
            "review": json.loads(row["review"]),
            "approved": bool(row["approved"]),
        }

    def stage_draft(self, state: WorkflowState, artifact: dict, review: dict, approved: bool) -> dict:
        version = self.db.execute(
            "SELECT COALESCE(MAX(version),0)+1 FROM drafts WHERE task_id=?", (state["task_id"],)
        ).fetchone()[0]
        package_hash = digest(json.dumps(artifact, ensure_ascii=False, sort_keys=True))
        self.db.execute(
            "INSERT INTO drafts(task_id,version,input_hash,package_hash,payload,review,approved) VALUES(?,?,?,?,?,?,?)",
            (
                state["task_id"], version, state["input_hash"], package_hash,
                json.dumps(artifact, ensure_ascii=False, sort_keys=True),
                json.dumps(review, ensure_ascii=False, sort_keys=True), int(approved),
            ),
        )
        return self.draft(state["task_id"])

    def confirm_apply(self, task_id: str, current_input: str) -> dict:
        task = self.task(task_id)
        if task["status"] == "completed":
            return self.result(task_id)
        draft = self.draft(task_id)
        if task["module"] != "apply" or task["status"] != "waiting" or not draft:
            raise ValueError("apply task is not waiting for review")
        if task["input_hash"] != digest(current_input) or draft["input_hash"] != task["input_hash"]:
            self.wait(task_id, "input_changed")
            raise ValueError("apply inputs changed; regenerate before confirmation")
        if not draft["approved"] or draft["review"].get("verdict") != "approve":
            raise ValueError("current package has not passed independent review")
        payload = {
            "module": "apply", "outcome": "package_confirmed", "artifact": draft,
            "input_hash": task["input_hash"], "material_hash": draft["package_hash"],
        }
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute(
                "INSERT INTO results(result_key,task_id,opportunity_id,module,input_hash,payload) VALUES(?,?,?,?,?,?)",
                (task_id, task_id, task["opportunity_id"], "apply", task["input_hash"], json.dumps(payload, sort_keys=True)),
            )
            self.db.execute(
                "INSERT INTO confirmations(task_id,input_hash,package_hash) VALUES(?,?,?)",
                (task_id, task["input_hash"], draft["package_hash"]),
            )
            self.db.execute("UPDATE tasks SET status='completed',waiting_reason=NULL WHERE task_id=?", (task_id,))
            self.db.execute("INSERT INTO events(task_id,type) VALUES(?, 'confirmed')", (task_id,))
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise
        return payload

    def find_task(self, identifier: str) -> sqlite3.Row:
        row = self.db.execute("SELECT * FROM tasks WHERE task_id=?", (identifier,)).fetchone()
        if row:
            return row
        rows = self.db.execute(
            "SELECT * FROM tasks WHERE opportunity_id=? ORDER BY rowid DESC LIMIT 2", (identifier,)
        ).fetchall()
        if not rows:
            raise ValueError(f"Unknown task or opportunity: {identifier}")
        if len(rows) > 1:
            raise ValueError(f"Opportunity has multiple tasks; use task_id: {identifier}")
        return rows[0]

    def list_tasks(self) -> list[sqlite3.Row]:
        return self.db.execute("SELECT * FROM tasks ORDER BY rowid").fetchall()

    def cancel(self, task_id: str) -> sqlite3.Row:
        task = self.task(task_id)
        if task["status"] in ("completed", "cancelled"):
            return task
        self.db.execute(
            "UPDATE tasks SET status='cancelled',waiting_reason=NULL WHERE task_id=?", (task_id,)
        )
        self.db.execute(
            "INSERT INTO events(task_id,type) VALUES(?, 'cancelled')", (task_id,)
        )
        return self.task(task_id)

    def wait(self, task_id: str, reason: str) -> None:
        self.db.execute(
            "UPDATE tasks SET status='waiting',waiting_reason=? WHERE task_id=? AND status!='completed'",
            (reason, task_id),
        )

    def reset_input(self, task_id: str, input_text: str) -> sqlite3.Row:
        row = self.task(task_id)
        input_hash = digest(input_text)
        if input_hash != row["input_hash"]:
            self.db.execute(
                "UPDATE tasks SET input_hash=?,input_payload=?,attempt=attempt+1,status='running',waiting_reason=NULL WHERE task_id=?",
                (input_hash, input_text, task_id),
            )
        elif row["status"] == "waiting":
            self.db.execute(
                "UPDATE tasks SET attempt=attempt+1,status='running',waiting_reason=NULL WHERE task_id=?",
                (task_id,),
            )
        return self.task(task_id)

    def resume_current(self, task_id: str) -> sqlite3.Row:
        self.db.execute("UPDATE tasks SET status='running',waiting_reason=NULL,attempt=attempt+1 WHERE task_id=? AND status='waiting'", (task_id,))
        return self.task(task_id)

    def publish(self, state: WorkflowState) -> dict:
        task = self.task(state["task_id"])
        if task["input_hash"] != state["input_hash"]:
            self.wait(state["task_id"], "input_changed")
            raise ValueError("Input changed before business commit")
        artifact = json.loads(state["draft"]) if state["draft"].startswith("{") else {"report": state["draft"]}
        payload = {
            "module": task["module"],
            "outcome": state["outcome"],
            "artifact": artifact,
            "review": state.get("review"),
            "input_hash": state["input_hash"],
            "material_hash": state["material_hash"],
        }
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute(
                "INSERT INTO results(result_key,task_id,opportunity_id,module,input_hash,payload) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                (
                    state["task_id"],
                    state["task_id"],
                    task["opportunity_id"],
                    task["module"],
                    state["input_hash"],
                    json.dumps(payload, sort_keys=True),
                ),
            )
            self.db.execute(
                "UPDATE tasks SET status='completed',waiting_reason=NULL WHERE task_id=?",
                (state["task_id"],),
            )
            self.db.execute(
                "INSERT INTO events(task_id,type,payload) VALUES(?, 'published', ?)",
                (state["task_id"], json.dumps({"input_hash": state["input_hash"]})),
            )
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise
        return payload


def task_view(store: BusinessStore, task: sqlite3.Row) -> dict:
    """Return the stable JSON shape shared by start, show, list, resume and cancel."""
    result = store.result(task["task_id"])
    draft = store.draft(task["task_id"]) if task["module"] == "apply" and not result else None
    reason = task["waiting_reason"]
    if task["module"] == "apply" and task["status"] == "waiting":
        actions = ["feedback", "confirm", "defer", "cancel"] if reason in ("user_review", "user_deferred", "input_changed") else ["feedback", "defer", "cancel"]
        if reason == "jd_changed":
            actions = ["accept-jd-change", "defer", "cancel"]
    else:
        actions = ["resume", "cancel"] if task["status"] == "waiting" else []
    return {
        "task_id": task["task_id"],
        "opportunity_id": task["opportunity_id"],
        "module": task["module"],
        "status": task["status"],
        "reason": reason,
        "artifact": result or draft,
        "attempt": task["attempt"],
        "allowed_actions": actions,
        **({"input_change": store.context(task["task_id"], "input_change")} if reason == "jd_changed" else {}),
    }


def view(directory: Path, identifier: str) -> dict:
    store = BusinessStore(directory / "business.db")
    try:
        task = store.find_task(identifier)
        refresh_apply_validity(store, task)
        return task_view(store, store.task(task["task_id"]))
    finally:
        store.close()


def list_views(directory: Path) -> list[dict]:
    store = BusinessStore(directory / "business.db")
    try:
        tasks = store.list_tasks()
        for task in tasks:
            refresh_apply_validity(store, task)
        return [task_view(store, store.task(task["task_id"])) for task in tasks]
    finally:
        store.close()


def cancel_task(directory: Path, task_id: str) -> dict:
    store = BusinessStore(directory / "business.db")
    try:
        return task_view(store, store.cancel(task_id))
    finally:
        store.close()


def current_apply_input(store: BusinessStore, task: sqlite3.Row, jd_report: dict | None = None) -> str:
    inputs = json.loads(task["input_payload"])
    return apply_inputs(
        jd_report or inputs["jd_report"], inputs["score_result"], store.feedback(task["task_id"])
    )


def refresh_apply_validity(store: BusinessStore, task: sqlite3.Row) -> None:
    if task["module"] != "apply" or task["status"] not in ("running", "waiting"):
        return
    if store.context(task["task_id"], "input_change"):
        store.wait(task["task_id"], "jd_changed")
    elif digest(current_apply_input(store, task)) != task["input_hash"]:
        store.wait(task["task_id"], "input_changed")


class Runtime:
    """Build one explicit graph while keeping formal writes behind BusinessStore."""

    def __init__(self, store: BusinessStore, fault_dir: Path, crash_at: str | None = None):
        self.store = store
        self.fault_dir = fault_dir
        self.crash_at = crash_at
        self.started_at = time.monotonic()

    def crash_once(self, state: WorkflowState, stage: str) -> None:
        marker = self.fault_dir / f"{state['task_id']}-{stage}.faulted"
        if self.crash_at == stage and not marker.exists():
            marker.touch()
            os._exit(86)

    def run_model(self, phase: str, payload: dict, state: WorkflowState) -> dict:
        """Call one fresh model process while enforcing the module budget."""
        if state["tool_calls"] >= 20:
            raise TimeoutError("tool_budget_exhausted")
        configured = os.environ.get("CAREER_OPS_MODEL_RUNNER")
        command = shlex.split(configured) if configured else [
            str(Path.home() / ".hermes" / "hermes-agent" / "venv" / "bin" / "python"),
            str(MODEL_RUNNER),
        ]
        try:
            for attempt in range(3):
                remaining = 900 - (time.monotonic() - self.started_at)
                if remaining <= 0:
                    raise TimeoutError("time_budget_exhausted")
                result = subprocess.run(
                    [*command, phase], input=json.dumps(payload, ensure_ascii=False), text=True,
                    capture_output=True, timeout=max(1, remaining), cwd=ROOT,
                )
                if result.returncode == 0 or attempt == 2:
                    break
        except subprocess.TimeoutExpired as error:
            raise TimeoutError("time_budget_exhausted") from error
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or f"model runner exited {result.returncode}")
        value = json.loads(result.stdout)
        calls = int(value.pop("tool_calls", 0))
        if state["tool_calls"] + calls > 20:
            raise TimeoutError("tool_budget_exhausted")
        value["tool_calls"] = state["tool_calls"] + calls
        return value

    def evaluate(self, state: WorkflowState) -> dict:
        if state["draft"] == "raise":
            raise RuntimeError("injected single-job failure")
        task = self.store.task(state["task_id"])
        if task["input_payload"].startswith("{"):
            inputs = json.loads(task["input_payload"])
            if task["module"] == "apply":
                result = self.run_model(
                    "apply_evaluate",
                    {
                        "inputs": inputs, "revision": state["revision"],
                        "previous_review": state.get("review"),
                        "previous_artifact": json.loads(state["draft"]) if state["revision"] else None,
                    },
                    state,
                )
                artifact = result["artifact"]
                return {
                    "outcome": "package", "draft": json.dumps(artifact, ensure_ascii=False, sort_keys=True),
                    "material_hash": digest(json.dumps(artifact, ensure_ascii=False, sort_keys=True)),
                    "tool_calls": result["tool_calls"],
                }
            if task["module"] == "scan":
                if inputs["source"]["liveness"] == "uncertain":
                    return {"waiting_reason": "source_access_unknown"}
                result = self.run_model("scan_evaluate", {"inputs": inputs, "revision": state["revision"]}, state)
                if result.get("waiting_reason"):
                    return {"waiting_reason": result["waiting_reason"], "tool_calls": result["tool_calls"]}
                artifact = result["artifact"]
                if result["outcome"] == "jd_report":
                    score_inputs(artifact)
                return {
                    "outcome": result["outcome"],
                    "draft": json.dumps(artifact, ensure_ascii=False, sort_keys=True),
                    "material_hash": digest(json.dumps(artifact, ensure_ascii=False, sort_keys=True)),
                    "tool_calls": result["tool_calls"],
                }
            if inputs["jd_report"]["prescreen"]["status"] == "incomplete":
                return {"waiting_reason": "core_evidence_missing"}
            result = self.run_model(
                "evaluate",
                {
                    "inputs": inputs, "revision": state["revision"],
                    "previous_review": state.get("review"),
                    "previous_artifact": json.loads(state["draft"]) if state["revision"] else None,
                },
                state,
            )
            artifact = result["artifact"]
            return {
                "outcome": result["outcome"],
                "draft": json.dumps(artifact, ensure_ascii=False, sort_keys=True),
                "material_hash": digest(json.dumps(artifact, ensure_ascii=False, sort_keys=True)),
                "tool_calls": result["tool_calls"],
            }
        outcome = "exclude" if state["draft"] == "exclude" else "score"
        return {
            "outcome": outcome,
            "draft": f"{outcome}-result-r{state['revision']}",
            "material_hash": digest(f"{state['module']}:{state['input_hash']}:r{state['revision']}"),
        }

    def review(self, state: WorkflowState) -> dict:
        self.crash_once(state, "review")
        task = self.store.task(state["task_id"])
        if task["module"] == "apply" and (
            state["tool_calls"] >= 20 or time.monotonic() - self.started_at >= 900
        ):
            return {
                "review_approved": False,
                "revision": MAX_CORRECTIONS + 1,
                "review": {"verdict": "blocked", "required_changes": ["Execution budget exhausted before review"]},
            }
        if task["input_payload"].startswith("{"):
            decision = self.run_model(
                {"scan": "scan_review", "score": "review", "apply": "apply_review"}[task["module"]],
                {"inputs": json.loads(task["input_payload"]), "artifact": json.loads(state["draft"])},
                state,
            )
            approved = decision["verdict"] == "approve"
            return {
                "review_approved": approved,
                "revision": state["revision"] + (0 if approved else 1),
                "tool_calls": decision["tool_calls"],
                "review": decision,
            }
        approved = state["revision"] >= state["required_corrections"]
        return {"review_approved": approved, "revision": state["revision"] + (0 if approved else 1)}

    @staticmethod
    def route_evaluate(state: WorkflowState) -> str:
        return "wait" if state.get("waiting_reason") else "review"

    @staticmethod
    def route_review(state: WorkflowState) -> str:
        if state["review_approved"]:
            return "stage" if state["module"] == "apply" else "publish"
        if state["revision"] > MAX_CORRECTIONS:
            return "stage_unapproved" if state["module"] == "apply" else "wait_review"
        return "evaluate"

    @staticmethod
    def wait_review(state: WorkflowState) -> dict:
        return {"waiting_reason": state.get("waiting_reason") or "review_budget_exhausted"}

    def publish(self, state: WorkflowState) -> dict:
        existing = self.store.result(state["task_id"])
        if existing:
            payload = existing
        else:
            artifact = json.loads(state["draft"]) if state["draft"].startswith("{") else None
            if artifact and artifact.get("report"):
                path = self.fault_dir / "artifacts" / state["task_id"] / state["input_hash"] / "report.md"
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix(".tmp")
                temporary.write_text(artifact["report"])
                temporary.replace(path)
                artifact["path"] = str(path)
                draft_directory = artifact.get("draft_directory")
                review = Path(draft_directory) / "report.md.review.json" if draft_directory else None
                if review and review.is_file():
                    review_path = Path(str(path) + ".review.json")
                    review_path.write_text(review.read_text())
                    artifact["review_path"] = str(review_path)
                state = {**state, "draft": json.dumps(artifact, ensure_ascii=False, sort_keys=True)}
            payload = self.store.publish(state)
        self.crash_once(state, "publish")
        return {"waiting_reason": None}

    def stage(self, state: WorkflowState, *, approved: bool = True) -> dict:
        package = json.loads(state["draft"])
        required = {
            "resume_payload", "changes", "cover_letter", "upskill",
            "interview_prep", "questions",
        }
        missing = sorted(required - package.keys())
        if missing or not package.get("resume_payload", {}).get("candidate", {}).get("name"):
            raise ValueError("Invalid application package: " + ", ".join(missing or ["resume candidate name"]))
        validate_resume_payload(package["resume_payload"])
        current = self.store.draft(state["task_id"])
        version = (current["version"] if current else 0) + 1
        root = self.fault_dir / "artifacts" / state["task_id"] / state["input_hash"] / f"package-v{version:03d}"
        root.mkdir(parents=True, exist_ok=True)
        names = {
            "resume_payload": "resume.json", "changes": "changes.md", "cover_letter": "cover-letter.md",
            "upskill": "upskill.md", "interview_prep": "interview-prep.md", "questions": "questions.md",
        }
        files = {}
        for key, name in names.items():
            path = root / name
            value = package[key]
            path.write_text(
                json.dumps(value, ensure_ascii=False, indent=2) + "\n" if key == "resume_payload" else str(value)
            )
            files[key] = str(path)
        artifact = {"files": files, "package": package}
        self.store.stage_draft(state, artifact, state["review"], approved)
        return {"waiting_reason": "user_review" if approved else "review_budget_exhausted"}

    def stage_unapproved(self, state: WorkflowState) -> dict:
        return self.stage(state, approved=False)

    def graph(self, checkpointer: SqliteSaver):
        graph = StateGraph(WorkflowState)
        graph.add_node("evaluate", self.evaluate)
        graph.add_node("review", self.review)
        graph.add_node("wait_review", self.wait_review)
        graph.add_node("publish", self.publish)
        graph.add_node("stage", self.stage)
        graph.add_node("stage_unapproved", self.stage_unapproved)
        graph.add_edge(START, "evaluate")
        graph.add_conditional_edges("evaluate", self.route_evaluate, {"wait": "wait_review", "review": "review"})
        graph.add_conditional_edges(
            "review",
            self.route_review,
            {
                "evaluate": "evaluate", "wait_review": "wait_review", "publish": "publish",
                "stage": "stage", "stage_unapproved": "stage_unapproved",
            },
        )
        graph.add_edge("wait_review", END)
        graph.add_edge("publish", END)
        graph.add_edge("stage", END)
        graph.add_edge("stage_unapproved", END)
        return graph.compile(checkpointer=checkpointer)


def initial_state(task: sqlite3.Row, required_corrections: int, scenario: str) -> WorkflowState:
    return {
        "task_id": task["task_id"],
        "module": task["module"],
        "input_hash": task["input_hash"],
        "required_corrections": required_corrections,
        "revision": 0,
        "outcome": "score",
        "draft": scenario,
        "review_approved": False,
        "review": {},
        "waiting_reason": None,
        "material_hash": "",
        "tool_calls": 0,
        "started_at": time.monotonic(),
    }


def run_task(
    directory: Path,
    task_id: str,
    *,
    start_state: WorkflowState | None = None,
    crash_at: str | None = None,
) -> dict:
    store = BusinessStore(directory / "business.db")
    try:
        task = store.task(task_id)
        existing = store.result(task_id)
        if existing:
            return {"task_id": task_id, "status": "completed", "result": existing, "reconciled": True}
        if task["workflow_version"] != WORKFLOW_VERSION:
            store.wait(task_id, "workflow_version_incompatible")
            return {"task_id": task_id, "status": "waiting", "reason": "workflow_version_incompatible"}
        runtime = Runtime(store, directory, crash_at)
        config = {"configurable": {"thread_id": f"{task_id}:{task['attempt']}"}}
        with SqliteSaver.from_conn_string(str(directory / "checkpoints.db")) as saver:
            graph = runtime.graph(saver)
            value = graph.invoke(start_state, config)
        if value.get("waiting_reason"):
            store.wait(task_id, value["waiting_reason"])
            return {"task_id": task_id, "status": "waiting", "reason": value["waiting_reason"]}
        return {"task_id": task_id, "status": store.task(task_id)["status"], "result": store.result(task_id)}
    except TimeoutError as error:
        store.wait(task_id, str(error))
        return {"task_id": task_id, "status": "waiting", "reason": str(error)}
    except Exception as error:
        store.wait(task_id, f"failure:{type(error).__name__}")
        raise
    finally:
        store.close()


def start_and_run(directory: Path, opportunity: str, module: str, input_text: str, corrections: int, scenario: str, crash_at: str | None, re_evaluate: bool = False) -> dict:
    store = BusinessStore(directory / "business.db")
    if module == "scan":
        input_text = canonical_scan_input(input_text)
        if not input_text.startswith("{"):
            store.close()
            raise ValueError("scan requires a scan_input_v1 JSON file")
    elif module == "score" and input_text.startswith("scan:"):
        scan = store.module_result(input_text.removeprefix("scan:"), "scan")
        if not scan or scan["outcome"] != "jd_report":
            store.close()
            raise ValueError("Missing reviewed scan result")
        input_text = score_inputs(scan["artifact"])
    elif module == "score":
        input_text = canonical_score_input(input_text)
    elif module == "apply" and input_text.startswith("score:"):
        upstream = input_text.removeprefix("score:")
        scan = store.module_result(upstream, "scan")
        score = store.module_result(upstream, "score")
        if not scan or scan["outcome"] != "jd_report" or not score or score["outcome"] != "score":
            store.close()
            raise ValueError("Missing current reviewed scan and score results")
        if score["input_hash"] != digest(score_inputs(scan["artifact"])):
            store.close()
            raise ValueError("Current score is stale for the scan or candidate inputs")
        input_text = apply_inputs(scan["artifact"], score, [])
    else:
        store.close()
        raise ValueError("apply requires score:<opportunity_id>")
    inputs = json.loads(input_text) if input_text.startswith("{") else None
    report = inputs["source"] if module == "scan" and inputs else inputs["jd_report"] if inputs else None
    if report and report["opportunity_id"] != opportunity:
        store.close()
        raise ValueError("CLI opportunity does not match the JD report")
    if module == "scan" and inputs:
        store.retain_source(opportunity, input_text)
    started = store.start(opportunity, module, input_text, re_evaluate=re_evaluate)
    task = store.task(started["task_id"])
    store.close()
    if started["status"] != "running":
        return started
    return run_task(directory, task["task_id"], start_state=initial_state(task, corrections, scenario), crash_at=crash_at)


def resume_task(
    directory: Path,
    task_id: str,
    input_text: str | None,
    crash_at: str | None,
    *,
    feedback: str | None = None,
    decision: str | None = None,
) -> dict:
    store = BusinessStore(directory / "business.db")
    task = store.task(task_id)
    if task["module"] == "apply":
        if task["status"] == "completed" and decision == "confirm":
            store.close()
            return {"task_id": task_id, "status": "completed"}
        if input_text is not None:
            report_input = canonical_score_input(input_text)
            if not report_input.startswith("{"):
                store.close()
                raise ValueError("--input requires a jd_report_v1 JSON file")
            report = json.loads(report_input)["jd_report"]
            old = json.loads(task["input_payload"])["jd_report"]
            if report["opportunity_id"] != task["opportunity_id"]:
                store.close()
                raise ValueError("CLI opportunity does not match the JD report")
            difference = "\n".join(difflib.unified_diff(
                old["jd"].splitlines(), report["jd"].splitlines(), fromfile="current", tofile="new", lineterm=""
            ))
            store.set_context(task_id, "input_change", {"jd_report": report, "diff": difference})
            store.wait(task_id, "jd_changed")
            result = task_view(store, store.task(task_id))
            store.close()
            return result
        if decision == "defer":
            store.wait(task_id, "user_deferred")
            result = task_view(store, store.task(task_id))
            store.close()
            return result
        if decision == "confirm":
            current = current_apply_input(store, task)
            store.confirm_apply(task_id, current)
            store.close()
            return {"task_id": task_id, "status": "completed"}
        if decision == "accept-jd-change":
            change = store.context(task_id, "input_change")
            if not change:
                store.close()
                raise ValueError("No pending JD change")
            input_text = current_apply_input(store, task, change["jd_report"])
            store.clear_context(task_id, "input_change")
            task = store.reset_input(task_id, input_text)
            store.close()
            return run_task(directory, task_id, start_state=initial_state(task, 0, "normal"), crash_at=crash_at)
        if feedback is not None:
            if store.context(task_id, "input_change"):
                store.close()
                raise ValueError("Resolve the pending JD change before feedback")
            store.add_feedback(task_id, feedback)
            input_text = current_apply_input(store, task)
            task = store.reset_input(task_id, input_text)
            store.close()
            return run_task(directory, task_id, start_state=initial_state(task, 0, "normal"), crash_at=crash_at)
        store.close()
        raise ValueError("apply resume requires --feedback, --input, or --decision")
    if input_text is not None:
        input_text = canonical_scan_input(input_text) if task["module"] == "scan" else canonical_score_input(input_text)
        if task["module"] == "scan" and not input_text.startswith("{"):
            store.close()
            raise ValueError("scan requires a scan_input_v1 JSON file")
        if task["module"] == "scan" and input_text.startswith("{"):
            store.retain_source(task["opportunity_id"], input_text)
    if input_text is not None:
        task = store.reset_input(task_id, input_text)
    elif task["status"] == "waiting":
        task = store.resume_current(task_id)
    store.close()
    return run_task(directory, task_id, start_state=initial_state(task, 0, "normal"), crash_at=crash_at)


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser()
    cli.add_argument("--directory", type=Path, default=ROOT / "data" / "workflow")
    commands = cli.add_subparsers(dest="command", required=True)
    start = commands.add_parser("start")
    start.add_argument("module", choices=("scan", "score", "apply"))
    start.add_argument("opportunity")
    start.add_argument("input")
    start.add_argument("--corrections", type=int, default=0, help=argparse.SUPPRESS)
    start.add_argument("--scenario", choices=("normal", "exclude", "raise"), default="normal", help=argparse.SUPPRESS)
    start.add_argument("--crash-at", choices=("review", "publish"), help=argparse.SUPPRESS)
    start.add_argument("--re-evaluate", action="store_true")
    run = commands.add_parser("run")
    run.add_argument("task_id")
    run.add_argument("--state", help=argparse.SUPPRESS)
    run.add_argument("--crash-at", choices=("review", "publish"), help=argparse.SUPPRESS)
    resume = commands.add_parser("resume")
    resume.add_argument("task_id")
    resume.add_argument("--input")
    resume.add_argument("--feedback")
    resume.add_argument("--decision", choices=("confirm", "defer", "accept-jd-change"))
    resume.add_argument("--crash-at", choices=("review", "publish"), help=argparse.SUPPRESS)
    show = commands.add_parser("show")
    show.add_argument("identifier")
    commands.add_parser("list")
    cancel = commands.add_parser("cancel")
    cancel.add_argument("task_id")
    return cli


def main() -> None:
    args = parser().parse_args()
    try:
        if args.command == "start":
            args.directory.mkdir(parents=True, exist_ok=True)
            started = start_and_run(args.directory, args.opportunity, args.module, args.input, args.corrections, args.scenario, args.crash_at, args.re_evaluate)
            result = view(args.directory, started["task_id"])
        elif args.command == "run":
            run_task(args.directory, args.task_id, start_state=json.loads(args.state) if args.state else None, crash_at=args.crash_at)
            result = view(args.directory, args.task_id)
        elif args.command == "resume":
            resume_task(
                args.directory, args.task_id, args.input, args.crash_at,
                feedback=args.feedback, decision=args.decision,
            )
            result = view(args.directory, args.task_id)
        elif args.command == "show":
            result = view(args.directory, args.identifier)
        elif args.command == "list":
            result = list_views(args.directory)
        elif args.command == "cancel":
            result = cancel_task(args.directory, args.task_id)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
