"""Run the local LangGraph workflow behind the Career Ops JSON CLI."""

from __future__ import annotations

import argparse
import difflib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
import re
import shutil
import shlex
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Literal, TypedDict
from urllib.parse import parse_qs, urlsplit

from dotenv import load_dotenv
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

try:
    from workflow.board_resolution import VENDOR_ORDER, format_summary, resolve_boards
    from workflow.reverse_runner import discover_global
    from workflow.discovery import capture_jd, discover
    from workflow.application_lifecycle import ApplicationStore, mutate as mutate_application
    from workflow.resume_renderer import render_resume
    from workflow.replies import import_reply, view_reply, confirm_reply, parse_pasted
    from workflow.insights.stats import stats_view
    from workflow.insights.reposts import repost_view
    from workflow.insights.company import company_view, company_signals
    from workflow.insights.salary import salary_view, stated_view
    from workflow.salary_observations import record_salary
    from workflow.insights.upskill import targeted_skill_gap, upskill_view
    from workflow.insights.preparation import build_preparation_plan
except ModuleNotFoundError:  # Direct script invocation keeps only workflow/ on sys.path.
    from board_resolution import VENDOR_ORDER, format_summary, resolve_boards
    from reverse_runner import discover_global
    from discovery import capture_jd, discover
    from application_lifecycle import ApplicationStore, mutate as mutate_application
    from resume_renderer import render_resume
    from replies import import_reply, view_reply, confirm_reply, parse_pasted
    from insights.stats import stats_view
    from insights.reposts import repost_view
    from insights.company import company_view, company_signals
    from insights.salary import salary_view, stated_view
    from salary_observations import record_salary
    from insights.upskill import targeted_skill_gap, upskill_view
    from insights.preparation import build_preparation_plan

os.environ.setdefault("LANGGRAPH_STRICT_MSGPACK", "true")

ROOT = Path(__file__).resolve().parents[1]


def load_project_environment(root: Path) -> None:
    """Load the same project .env that the former Node scan entrypoint used."""
    load_dotenv(root / ".env", override=False)


if __name__ == "__main__":
    load_project_environment(ROOT)


INPUT_ROOT = Path(os.environ.get("CAREER_OPS_INPUT_ROOT", ROOT))
WORKFLOW_VERSION = "oii-333-v1"
ATTEMPT_SECONDS = 900
ATTEMPT_CALLS = 20
MODEL_RUNNER = "workflow.model_runner"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def score_inputs(report: dict) -> str:
    """Bind a JD report to every module-level policy and candidate input."""
    required = {"schema_version", "opportunity_id", "url", "company", "role", "jd", "captured_at", "liveness", "prescreen"}
    missing = sorted(required - report.keys())
    if missing:
        raise ValueError("JD report missing: " + ", ".join(missing))
    if report["schema_version"] != "jd_report_v1":
        raise ValueError("Unsupported JD report schema")
    if report["liveness"] != "active" or not str(report["jd"]).strip():
        raise ValueError("A complete active JD report is required")
    if not all(str(report[key]).strip() for key in ("opportunity_id", "url", "company", "role", "captured_at")):
        raise ValueError("JD report identity and capture fields cannot be empty")
    if not isinstance(report["prescreen"], dict) or report["prescreen"].get("status") not in {"pass", "fail", "incomplete", "uncertain"}:
        raise ValueError("JD report prescreen status is invalid")
    inputs = {
        "jd_report": report,
        "cv": (INPUT_ROOT / "cv.md").read_text(),
        "profile": (INPUT_ROOT / "config" / "profile.yml").read_text(),
        "targeting": (INPUT_ROOT / "modes" / "_profile.md").read_text(),
        "rules": (INPUT_ROOT / "modes" / "_custom.md").read_text(),
        "articles": (INPUT_ROOT / "article-digest.md").read_text() if (INPUT_ROOT / "article-digest.md").is_file() else None,
        "voice": (INPUT_ROOT / "voice-dna.md").read_text() if (INPUT_ROOT / "voice-dna.md").is_file() else None,
        "writing_samples": {
            str(path.relative_to(INPUT_ROOT)): path.read_text()
            for path in sorted((INPUT_ROOT / "writing-samples").glob("**/*")) if path.is_file()
        } if (INPUT_ROOT / "writing-samples").is_dir() else {},
    }
    return json.dumps(inputs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_score_input(value: str) -> str:
    try:
        report = json.loads(value) if value.lstrip().startswith("{") else json.loads(Path(value).read_text())
    except (json.JSONDecodeError, OSError) as error:
        raise ValueError("score requires a jd_report_v1 JSON file or object") from error
    if not isinstance(report, dict) or "jd_report" in report:
        raise ValueError("score input must be one jd_report_v1 object, not a workflow envelope")
    return score_inputs(report)


def canonical_scan_input(value: str) -> str:
    try:
        source = json.loads(value) if value.lstrip().startswith("{") else json.loads(Path(value).read_text())
    except (json.JSONDecodeError, OSError) as error:
        raise ValueError("scan requires a scan_input_v1 JSON file or object") from error
    if not isinstance(source, dict) or "source" in source:
        raise ValueError("scan input must be one scan_input_v1 object, not a workflow envelope")
    required = {"schema_version", "opportunity_id", "url", "company", "role", "jd", "captured_at", "liveness"}
    missing = sorted(required - source.keys())
    if missing:
        raise ValueError("Scan input missing: " + ", ".join(missing))
    if source["schema_version"] != "scan_input_v1":
        raise ValueError("Unsupported scan input schema")
    if any(not isinstance(source[key], str) or not source[key].strip() for key in ("opportunity_id", "url", "company", "role", "captured_at")):
        raise ValueError("Scan input identity and capture fields must be nonempty strings")
    if not isinstance(source["jd"], str) or source["liveness"] not in {"active", "uncertain"}:
        raise ValueError("Scan input JD or liveness is invalid")
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
        "artifact_contract_version": 4,
        "jd_report": jd_report,
        "score_result": score_result,
        "cv": (INPUT_ROOT / "cv.md").read_text(),
        "profile": (INPUT_ROOT / "config" / "profile.yml").read_text(),
        "targeting": (INPUT_ROOT / "modes" / "_profile.md").read_text(),
        "rules": (INPUT_ROOT / "modes" / "_custom.md").read_text(),
        "contract": (INPUT_ROOT / "prompts" / "shared" / "contract.md").read_text(),
        "requirements": (INPUT_ROOT / "prompts" / "applications" / "workflow.md").read_text(),
        "articles": (INPUT_ROOT / "article-digest.md").read_text() if (INPUT_ROOT / "article-digest.md").is_file() else None,
        "voice": (INPUT_ROOT / "voice-dna.md").read_text() if (INPUT_ROOT / "voice-dna.md").is_file() else None,
        "writing_samples": {
            str(path.relative_to(INPUT_ROOT)): path.read_text()
            for path in sorted((INPUT_ROOT / "writing-samples").glob("**/*")) if path.is_file()
        } if (INPUT_ROOT / "writing-samples").is_dir() else {},
        "market_rules": {
            market: (INPUT_ROOT / "markets" / market / "employment.md").read_text()
            for market in ("cn", "hk", "remote")
        },
        "feedback": feedback,
    }
    return json.dumps(inputs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def validate_resume_payload(payload: dict) -> None:
    if not payload.get("candidate", {}).get("name") or not isinstance(payload.get("summary"), str):
        raise ValueError("resume_payload requires candidate.name and summary")
    if "projects_start_on_new_page" in payload and not isinstance(payload["projects_start_on_new_page"], bool):
        raise ValueError("resume_payload projects_start_on_new_page must be boolean")
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


def verify_package_files(draft: dict, *, require_pdf: bool) -> None:
    files = draft.get("files", {})
    required = {"resume_payload", "changes", "cover_letter", "upskill", "interview_prep", "questions"}
    if require_pdf:
        required |= {"resume_pdf", "resume_metadata"}
    if not isinstance(files, dict) or set(files) != required:
        raise ValueError("Current package file manifest is incomplete")
    if require_pdf and (not isinstance(draft.get("pdf_receipt"), dict)
                        or not isinstance(draft["pdf_receipt"].get("pages"), int)
                        or draft["pdf_receipt"]["pages"] < 1):
        raise ValueError("Current package has no validated resume PDF")
    if not isinstance(draft.get("file_hashes"), dict) or set(draft["file_hashes"]) != required:
        raise ValueError("Current package file manifest is incomplete")
    artifact = {name: draft.get(name) for name in ("files", "file_hashes", "package", "pdf_receipt")}
    if digest(json.dumps(artifact, ensure_ascii=False, sort_keys=True)) != draft.get("package_hash"):
        raise ValueError("Current package manifest changed")
    for name, path in files.items():
        try:
            current_hash = hashlib.sha256(Path(path).read_bytes()).hexdigest()
        except OSError as error:
            raise ValueError(f"Current package file is unavailable: {name}") from error
        if current_hash != draft["file_hashes"][name]:
            raise ValueError(f"Current package file changed: {name}")


class WorkflowState(TypedDict):
    task_id: str
    module: Literal["scan", "score", "apply"]
    input_hash: str
    outcome: Literal["jd_report", "score", "exclude", "package"]
    draft: str
    waiting_reason: str | None
    material_hash: str
    tool_calls: int
    has_prior_package: bool


class BusinessStore:
    """Own task identity, input validity, active ownership and formal results."""

    def __init__(self, path: Path):
        self.path = path
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
              input_payload TEXT NOT NULL,
              elapsed_seconds REAL NOT NULL DEFAULT 0,
              tool_calls INTEGER NOT NULL DEFAULT 0,
              attempt_elapsed_seconds REAL NOT NULL DEFAULT 0,
              attempt_tool_calls INTEGER NOT NULL DEFAULT 0
            );
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
            CREATE TABLE IF NOT EXISTS workflow_source_evidence (
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
        draft_columns = {row[1] for row in self.db.execute("PRAGMA table_info(drafts)")}
        for obsolete in ("review", "approved"):
            if obsolete in draft_columns:
                self.db.execute(f"ALTER TABLE drafts DROP COLUMN {obsolete}")
        task_columns = {row[1] for row in self.db.execute("PRAGMA table_info(tasks)")}
        if "elapsed_seconds" not in task_columns:
            self.db.execute("ALTER TABLE tasks ADD COLUMN elapsed_seconds REAL NOT NULL DEFAULT 0")
        if "tool_calls" not in task_columns:
            self.db.execute("ALTER TABLE tasks ADD COLUMN tool_calls INTEGER NOT NULL DEFAULT 0")
        if "attempt_elapsed_seconds" not in task_columns:
            self.db.execute("ALTER TABLE tasks ADD COLUMN attempt_elapsed_seconds REAL NOT NULL DEFAULT 0")
            self.db.execute("UPDATE tasks SET attempt_elapsed_seconds=elapsed_seconds")
        if "attempt_tool_calls" not in task_columns:
            self.db.execute("ALTER TABLE tasks ADD COLUMN attempt_tool_calls INTEGER NOT NULL DEFAULT 0")
            self.db.execute("UPDATE tasks SET attempt_tool_calls=tool_calls")
        self.db.executescript(
            """
            DROP INDEX IF EXISTS one_active_task_per_opportunity;
            CREATE UNIQUE INDEX one_active_task_per_opportunity
              ON tasks(opportunity_id)
              WHERE status='running' OR (status='waiting' AND module='apply');
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
        waiting = self.db.execute(
            "SELECT task_id,status,input_hash FROM tasks WHERE opportunity_id=? AND module=? AND status='waiting' ORDER BY rowid DESC LIMIT 1",
            (opportunity_id, module),
        ).fetchone()
        if waiting and not re_evaluate:
            if waiting["input_hash"] != input_hash:
                raise ValueError("Waiting task has different inputs; resume it with --input")
            return {"task_id": waiting["task_id"], "status": waiting["status"], "reused": False}
        self.db.execute("BEGIN IMMEDIATE")
        try:
            active = self.db.execute(
                "SELECT task_id,module,status,input_hash FROM tasks WHERE opportunity_id=? AND (status='running' OR (status='waiting' AND module='apply'))",
                (opportunity_id,),
            ).fetchone()
            if active:
                if active["module"] != module or active["input_hash"] != input_hash:
                    raise ValueError("Another task owns this opportunity; resume or complete it first")
                self.db.execute("COMMIT")
                return {"task_id": active["task_id"], "status": active["status"], "reused": False}
            task_id = str(uuid.uuid4())
            self.db.execute(
                "INSERT INTO tasks(task_id,opportunity_id,module,status,input_hash,workflow_version,input_payload) VALUES(?,?,?,'running',?,?,?)",
                (task_id, opportunity_id, module, input_hash, WORKFLOW_VERSION, input_text),
            )
            if module == "score" and self.db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='opportunities'"
            ).fetchone():
                claimed = self.db.execute(
                    "UPDATE opportunities SET state='evaluating',claimed_by=?,attempts=attempts+1 "
                    "WHERE id=? AND state='discovered'", (task_id, opportunity_id),
                ).rowcount
                if claimed:
                    self.db.execute(
                        "INSERT INTO opportunity_events(opportunity_id,type,payload) VALUES(?,'claimed',?)",
                        (opportunity_id, json.dumps({"worker": task_id})),
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
            "INSERT OR IGNORE INTO workflow_source_evidence(source_hash,opportunity_id,url,captured_at,payload) VALUES(?,?,?,?,?)",
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
        }

    def stage_draft(self, state: WorkflowState, artifact: dict) -> dict:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            task = self.task(state["task_id"])
            if task["status"] != "running" or task["input_hash"] != state["input_hash"]:
                raise ValueError("Apply task is no longer running with the current input")
            version = self.db.execute(
                "SELECT COALESCE(MAX(version),0)+1 FROM drafts WHERE task_id=?", (state["task_id"],)
            ).fetchone()[0]
            package_hash = digest(json.dumps(artifact, ensure_ascii=False, sort_keys=True))
            self.db.execute(
                "INSERT INTO drafts(task_id,version,input_hash,package_hash,payload) VALUES(?,?,?,?,?)",
                (
                    state["task_id"], version, state["input_hash"], package_hash,
                    json.dumps(artifact, ensure_ascii=False, sort_keys=True),
                ),
            )
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise
        return self.draft(state["task_id"])

    def confirm_apply(self, task_id: str, current_input: str) -> dict:
        task = self.task(task_id)
        draft = self.draft(task_id)
        if task["module"] != "apply" or task["status"] not in ("waiting", "completed") or not draft:
            raise ValueError("apply task has no package awaiting confirmation")
        if task["input_hash"] != digest(current_input) or draft["input_hash"] != task["input_hash"]:
            if task["status"] == "waiting":
                self.wait(task_id, "input_changed")
            raise ValueError("apply inputs changed; regenerate before confirmation")
        verify_package_files(draft, require_pdf=True)
        if task["status"] == "completed":
            return self.result(task_id)
        payload = {
            "module": "apply", "outcome": "package_confirmed", "artifact": draft,
            "input_hash": task["input_hash"], "material_hash": draft["package_hash"],
        }
        self.db.execute("BEGIN IMMEDIATE")
        try:
            current = self.task(task_id)
            if current["status"] != "waiting" or current["input_hash"] != task["input_hash"]:
                raise ValueError("Apply task changed before confirmation")
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
        self.db.execute("BEGIN IMMEDIATE")
        try:
            task = self.task(task_id)
            if task["status"] in ("running", "waiting"):
                self.db.execute(
                    "UPDATE tasks SET status='cancelled',waiting_reason=NULL WHERE task_id=?", (task_id,)
                )
                self.db.execute(
                    "INSERT INTO events(task_id,type) VALUES(?, 'cancelled')", (task_id,)
                )
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise
        return self.task(task_id)

    def wait(self, task_id: str, reason: str) -> None:
        self.db.execute(
            "UPDATE tasks SET status='waiting',waiting_reason=? WHERE task_id=? AND status IN ('running','waiting')",
            (reason, task_id),
        )

    def reset_input(self, task_id: str, input_text: str) -> sqlite3.Row:
        row = self.task(task_id)
        if row["status"] != "waiting":
            raise ValueError(f"Only a waiting task can resume; task is {row['status']}")
        input_hash = digest(input_text)
        if input_hash != row["input_hash"]:
            updated = self.db.execute(
                "UPDATE tasks SET input_hash=?,input_payload=?,attempt=attempt+1,attempt_elapsed_seconds=0,attempt_tool_calls=0,status='running',waiting_reason=NULL "
                "WHERE task_id=? AND status='waiting'",
                (input_hash, input_text, task_id),
            )
        else:
            updated = self.db.execute(
                "UPDATE tasks SET attempt=attempt+1,attempt_elapsed_seconds=0,attempt_tool_calls=0,status='running',waiting_reason=NULL "
                "WHERE task_id=? AND status='waiting'",
                (task_id,),
            )
        if updated.rowcount != 1:
            raise ValueError("Task is no longer waiting; refresh before resuming")
        return self.task(task_id)

    def resume_current(self, task_id: str) -> sqlite3.Row:
        row = self.task(task_id)
        if row["status"] != "waiting":
            raise ValueError(f"Only a waiting task can resume; task is {row['status']}")
        updated = self.db.execute("UPDATE tasks SET status='running',waiting_reason=NULL,attempt=attempt+1,attempt_elapsed_seconds=0,attempt_tool_calls=0 WHERE task_id=? AND status='waiting'", (task_id,))
        if updated.rowcount != 1:
            raise ValueError("Task is no longer waiting; refresh before resuming")
        return self.task(task_id)

    def resume_failed_checkpoint(self, task_id: str) -> sqlite3.Row:
        updated = self.db.execute(
            "UPDATE tasks SET status='running',waiting_reason=NULL WHERE task_id=? "
            "AND status='waiting' AND waiting_reason LIKE 'failure:%'", (task_id,),
        )
        if updated.rowcount != 1:
            raise ValueError("Task is no longer waiting after a failed checkpoint")
        return self.task(task_id)

    def add_usage(self, task_id: str, seconds: float, tool_calls: int) -> sqlite3.Row:
        self.db.execute(
            "UPDATE tasks SET elapsed_seconds=elapsed_seconds+?,tool_calls=tool_calls+?,attempt_elapsed_seconds=attempt_elapsed_seconds+?,attempt_tool_calls=attempt_tool_calls+? WHERE task_id=?",
            (max(0, seconds), max(0, tool_calls), max(0, seconds), max(0, tool_calls), task_id),
        )
        return self.task(task_id)

    def publish(self, state: WorkflowState) -> dict:
        task = self.task(state["task_id"])
        if task["status"] != "running":
            raise ValueError("Task is no longer running with the current input")
        if task["input_hash"] != state["input_hash"]:
            self.wait(state["task_id"], "input_changed")
            raise ValueError("Input changed before business commit")
        if task["module"] == "score":
            current = score_inputs(json.loads(task["input_payload"])["jd_report"])
            if digest(current) != task["input_hash"]:
                self.wait(state["task_id"], "input_changed")
                raise ValueError("Score inputs changed before business commit")
        if task["module"] == "scan":
            current = canonical_scan_input(json.dumps(json.loads(task["input_payload"])["source"]))
            if digest(current) != task["input_hash"]:
                self.wait(state["task_id"], "input_changed")
                raise ValueError("Scan inputs changed before business commit")
        artifact = json.loads(state["draft"]) if state["draft"].startswith("{") else {"report": state["draft"]}
        if task["module"] == "scan" and state["outcome"] == "jd_report":
            source = json.loads(task["input_payload"])["source"]
            score_inputs(artifact)
            if any(artifact[key] != source[key] for key in ("opportunity_id", "url", "jd", "captured_at")):
                raise ValueError("Scan report differs from retained source")
        if task["module"] == "score" and state["outcome"] == "score":
            score = artifact.get("score", {})
            if (
                artifact.get("type") != "score"
                or not artifact.get("report")
                or artifact.get("report_sha256") != digest(artifact["report"])
                or not isinstance(score, dict)
                or set(score) != {"lower", "upper", "coverage"}
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in score.values())
                or not (1 <= score["lower"] <= score["upper"] <= 5)
                or not (0 <= score["coverage"] <= 1)
            ):
                raise ValueError("Score artifact or report hash is invalid")
        if state["outcome"] == "exclude" and (
            artifact.get("type") != "exclusion" or not artifact.get("reason") or not artifact.get("evidence")
        ):
            raise ValueError("Exclusion requires a reason and evidence")
        payload = {
            "module": task["module"],
            "outcome": state["outcome"],
            "artifact": artifact,
            "input_hash": state["input_hash"],
            "material_hash": state["material_hash"],
        }
        self.db.execute("BEGIN IMMEDIATE")
        try:
            current = self.task(state["task_id"])
            if current["status"] != "running" or current["input_hash"] != state["input_hash"]:
                raise ValueError("Task is no longer running with the current input")
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
            opportunity = self.db.execute(
                "SELECT id FROM opportunities WHERE id=?", (task["opportunity_id"],)
            ).fetchone() if self.db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='opportunities'"
            ).fetchone() else None
            if opportunity and task["module"] in {"scan", "score"}:
                opportunity_id = opportunity["id"]
                if state["outcome"] == "exclude":
                    self.db.execute("UPDATE opportunities SET state='evaluating' WHERE id=?", (opportunity_id,))
                    self.db.execute(
                        "INSERT INTO eligibility(opportunity_id,status,evidence) VALUES(?,'fail',?) "
                        "ON CONFLICT(opportunity_id) DO UPDATE SET status='fail',evidence=excluded.evidence",
                        (opportunity_id, json.dumps(artifact, ensure_ascii=False)),
                    )
                    self.db.execute("UPDATE opportunities SET state='ineligible' WHERE id=?", (opportunity_id,))
                    self.db.execute(
                        "INSERT INTO checkpoints(opportunity_id,phase,input_hash,output_hash) VALUES(?,'discard',?,?) "
                        "ON CONFLICT(opportunity_id,phase) DO UPDATE SET input_hash=excluded.input_hash,output_hash=excluded.output_hash",
                        (opportunity_id, state["input_hash"], state["material_hash"]),
                    )
                    self.db.execute(
                        "INSERT INTO opportunity_events(opportunity_id,type,payload) VALUES(?,'discarded',?)",
                        (opportunity_id, json.dumps(artifact, ensure_ascii=False)),
                    )
                elif task["module"] == "score" and state["outcome"] == "score":
                    prescreen = json.loads(task["input_payload"])["jd_report"]["prescreen"]
                    eligibility = "pass" if prescreen["status"] == "pass" else "unknown"
                    self.db.execute("UPDATE opportunities SET state='evaluating' WHERE id=?", (opportunity_id,))
                    self.db.execute(
                        "INSERT INTO eligibility(opportunity_id,status,evidence) VALUES(?,?,?) "
                        "ON CONFLICT(opportunity_id) DO UPDATE SET status=excluded.status,evidence=excluded.evidence",
                        (opportunity_id, eligibility, json.dumps(prescreen, ensure_ascii=False)),
                    )
                    self.db.execute("UPDATE opportunities SET state='eligible' WHERE id=?", (opportunity_id,))
                    self.db.execute(
                        "INSERT INTO opportunity_events(opportunity_id,type,payload) VALUES(?,'eligibility_recorded',?)",
                        (opportunity_id, json.dumps({"status": eligibility})),
                    )
                    self.db.execute(
                        "INSERT INTO evaluations(opportunity_id,lower_score,upper_score,coverage,report_hash) "
                        "VALUES(?,?,?,?,?) ON CONFLICT(opportunity_id) DO UPDATE SET "
                        "lower_score=excluded.lower_score,upper_score=excluded.upper_score,"
                        "coverage=excluded.coverage,report_hash=excluded.report_hash,created_at=CURRENT_TIMESTAMP",
                        (opportunity_id, artifact["score"]["lower"], artifact["score"]["upper"],
                         artifact["score"]["coverage"], artifact["report_sha256"]),
                    )
                    self.db.execute("UPDATE opportunities SET state='evaluated' WHERE id=?", (opportunity_id,))
                    self.db.execute(
                        "INSERT INTO opportunity_events(opportunity_id,type,payload) VALUES(?,'evaluation_recorded',?)",
                        (opportunity_id, json.dumps({"reportHash": artifact["report_sha256"]})),
                    )
                    self.db.execute(
                        "INSERT OR IGNORE INTO artifacts(opportunity_id,kind,path,sha256) VALUES(?,'report',?,?)",
                        (opportunity_id, artifact["path"], artifact["report_sha256"]),
                    )
                    self.db.execute(
                        "INSERT INTO checkpoints(opportunity_id,phase,input_hash,output_hash) VALUES(?,'publish',?,?) "
                        "ON CONFLICT(opportunity_id,phase) DO UPDATE SET input_hash=excluded.input_hash,output_hash=excluded.output_hash",
                        (opportunity_id, state["input_hash"], artifact["report_sha256"]),
                    )
                    self.db.execute(
                        "INSERT INTO opportunity_events(opportunity_id,type,payload) VALUES(?,'published',?)",
                        (opportunity_id, json.dumps({"reportHash": artifact["report_sha256"]})),
                    )
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise
        return payload

    def score_views(self) -> list[dict]:
        rows = self.db.execute(
            "SELECT opportunity_id,input_hash,payload FROM results WHERE module='score' ORDER BY rowid DESC"
        ).fetchall()
        latest = {}
        for row in rows:
            latest.setdefault(row["opportunity_id"], row)
        values = []
        for opportunity_id, row in latest.items():
            payload = json.loads(row["payload"])
            artifact = payload.get("artifact", {})
            score = artifact.get("score")
            valid = False
            reason = "score_metadata_missing"
            source_task = self.db.execute(
                "SELECT input_payload FROM tasks WHERE opportunity_id=? AND module='score' AND input_hash=? ORDER BY rowid DESC LIMIT 1",
                (opportunity_id, row["input_hash"]),
            ).fetchone()
            if score and source_task:
                try:
                    current = score_inputs(json.loads(source_task["input_payload"])["jd_report"])
                    valid = digest(current) == row["input_hash"]
                    reason = None if valid else "candidate_or_policy_inputs_changed"
                except (KeyError, OSError, ValueError):
                    reason = "stored_input_invalid"
            if score:
                values.append({
                    "opportunity_id": opportunity_id, "lower": score["lower"], "upper": score["upper"],
                    "coverage": score["coverage"], "valid": valid, "stale_reason": reason,
                    "_rank": score["lower"] + (score["upper"] - score["lower"]) * score["coverage"],
                })
        values.sort(key=lambda item: (-item["_rank"], -item["coverage"], item["opportunity_id"]))
        return [{key: value for key, value in item.items() if key != "_rank"} for item in values]


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
    store = BusinessStore(directory / "opportunities.db")
    try:
        task = store.find_task(identifier)
        refresh_apply_validity(store, task)
        return task_view(store, store.task(task["task_id"]))
    finally:
        store.close()


def list_views(directory: Path) -> list[dict]:
    store = BusinessStore(directory / "opportunities.db")
    try:
        tasks = store.list_tasks()
        for task in tasks:
            refresh_apply_validity(store, task)
        return [task_view(store, store.task(task["task_id"])) for task in tasks]
    finally:
        store.close()


def cancel_task(directory: Path, task_id: str) -> dict:
    store = BusinessStore(directory / "opportunities.db")
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
        task = self.store.task(state["task_id"])
        calls_before = task["attempt_tool_calls"]
        if task["attempt_tool_calls"] >= ATTEMPT_CALLS:
            raise TimeoutError("tool_budget_exhausted")
        configured = os.environ.get("CAREER_OPS_MODEL_RUNNER")
        command = shlex.split(configured) if configured else [sys.executable, "-m", MODEL_RUNNER]
        try:
            remaining = ATTEMPT_SECONDS - task["attempt_elapsed_seconds"] - (time.monotonic() - self.started_at)
            if remaining <= 0:
                raise TimeoutError("time_budget_exhausted")
            with subprocess.Popen(
                [*command, phase], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, start_new_session=True, cwd=ROOT,
                env={**os.environ, "CAREER_OPS_DRAFT_ROOT": os.environ.get(
                    "CAREER_OPS_DRAFT_ROOT", str(self.store.path.parent / "workflow-drafts")
                ), "CAREER_OPS_USAGE_DB": str(self.store.path),
                    "CAREER_OPS_USAGE_TASK_ID": state["task_id"],
                    "CAREER_OPS_TOOL_LIMIT": str(ATTEMPT_CALLS)},
            ) as process:
                try:
                    stdout, stderr = process.communicate(json.dumps(payload, ensure_ascii=False), timeout=max(1, remaining))
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.communicate()
                    raise
                result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
        except subprocess.TimeoutExpired as error:
            self.store.add_usage(state["task_id"], time.monotonic() - self.started_at, 0)
            self.started_at = time.monotonic()
            raise TimeoutError("time_budget_exhausted") from error
        if result.returncode:
            task = self.store.add_usage(state["task_id"], time.monotonic() - self.started_at, 0)
            self.started_at = time.monotonic()
            if task["attempt_tool_calls"] >= ATTEMPT_CALLS:
                raise TimeoutError("tool_budget_exhausted")
            raise RuntimeError(result.stderr.strip() or f"model runner exited {result.returncode}")
        try:
            value = json.loads(result.stdout)
            if not isinstance(value, dict):
                raise ValueError("Model runner response must be an object")
            reported_calls = int(value.pop("tool_calls", 0))
        except (ValueError, TypeError, OverflowError):
            self.store.add_usage(state["task_id"], time.monotonic() - self.started_at, 0)
            self.started_at = time.monotonic()
            raise
        durable_calls = self.store.task(state["task_id"])["attempt_tool_calls"] - calls_before
        calls = reported_calls if configured and not durable_calls else 0
        task = self.store.add_usage(state["task_id"], time.monotonic() - self.started_at, calls)
        self.started_at = time.monotonic()
        if task["attempt_tool_calls"] >= ATTEMPT_CALLS:
            raise TimeoutError("tool_budget_exhausted")
        value["tool_calls"] = task["tool_calls"]
        return value

    def evaluate(self, state: WorkflowState) -> dict:
        task = self.store.task(state["task_id"])
        inputs = json.loads(task["input_payload"])
        if task["input_payload"].startswith("{"):
            if task["module"] == "apply":
                result = self.run_model(
                    "apply_evaluate",
                    {
                        "inputs": inputs,
                        "previous_artifact": json.loads(state["draft"]) if state.get("has_prior_package") else None,
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
                result = self.run_model("scan_evaluate", {"inputs": inputs}, state)
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
                {"inputs": inputs},
                state,
            )
            artifact = result["artifact"]
            return {
                "outcome": result["outcome"],
                "draft": json.dumps(artifact, ensure_ascii=False, sort_keys=True),
                "material_hash": digest(json.dumps(artifact, ensure_ascii=False, sort_keys=True)),
                "tool_calls": result["tool_calls"],
            }
        raise ValueError("Workflow input must be canonical JSON")

    @staticmethod
    def route_evaluate(state: WorkflowState) -> str:
        return "wait" if state.get("waiting_reason") else "stage" if state["module"] == "apply" else "publish"

    @staticmethod
    def wait(state: WorkflowState) -> dict:
        return {"waiting_reason": state["waiting_reason"]}

    def publish(self, state: WorkflowState) -> dict:
        existing = self.store.result(state["task_id"])
        if existing:
            payload = existing
        else:
            self.crash_once(state, "before_publish")
            artifact = json.loads(state["draft"]) if state["draft"].startswith("{") else None
            if artifact and artifact.get("report"):
                path = self.fault_dir / "artifacts" / state["task_id"] / state["input_hash"] / "report.md"
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix(".tmp")
                temporary.write_text(artifact["report"])
                temporary.replace(path)
                artifact["path"] = str(path)
                state = {**state, "draft": json.dumps(artifact, ensure_ascii=False, sort_keys=True)}
            payload = self.store.publish(state)
        self.crash_once(state, "publish")
        return {"waiting_reason": None}

    def stage(self, state: WorkflowState) -> dict:
        package = json.loads(state["draft"])
        required = {
            "resume_payload", "changes", "cover_letter", "upskill",
            "interview_prep", "questions",
        }
        missing = sorted(required - package.keys())
        if missing or not package.get("resume_payload", {}).get("candidate", {}).get("name"):
            raise ValueError("Invalid application package: " + ", ".join(missing or ["resume candidate name"]))
        for key in required - {"resume_payload"}:
            if not isinstance(package[key], str) or not package[key].strip():
                raise ValueError(f"Invalid application package: {key} must be a nonempty Markdown string")
        validate_resume_payload(package["resume_payload"])
        current = self.store.draft(state["task_id"])
        if current and current["input_hash"] == state["input_hash"] and current["package"] == package:
            try:
                verify_package_files(current, require_pdf=True)
            except ValueError:
                pass
            else:
                return {"waiting_reason": "user_review"}
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
        pdf_receipt = None
        remaining = ATTEMPT_SECONDS - self.store.task(state["task_id"])["attempt_elapsed_seconds"] - (time.monotonic() - self.started_at)
        if remaining <= 0:
            raise TimeoutError("time_budget_exhausted")
        pdf_path = root / "resume.pdf"
        metadata_path = root / "reactive-resume.json"
        previous_metadata = current.get("files", {}).get("resume_metadata") if current else None
        previous_metadata = previous_metadata or str(root.parents[1] / "reactive-resume.json")
        if not metadata_path.exists() and Path(previous_metadata).is_file():
            shutil.copyfile(previous_metadata, metadata_path)
        started = time.monotonic()
        try:
            inputs = json.loads(self.store.task(state["task_id"])["input_payload"])
            pdf_receipt = render_resume(
                state["task_id"], version, root.parents[1], Path(files["resume_payload"]),
                pdf_path, INPUT_ROOT / "config" / "profile.yml",
                package["resume_payload"]["candidate"]["name"],
                inputs["jd_report"]["company"], inputs["jd_report"]["role"],
                timeout_seconds=min(120, max(1, int(remaining))),
            )
        finally:
            self.store.add_usage(state["task_id"], time.monotonic() - started, 1)
        files["resume_pdf"] = str(pdf_path)
        files["resume_metadata"] = pdf_receipt["metadata_path"]
        artifact = {
            "files": files, "file_hashes": {
                name: hashlib.sha256(Path(path).read_bytes()).hexdigest()
                for name, path in files.items()
            }, "package": package, "pdf_receipt": pdf_receipt,
        }
        self.store.stage_draft(state, artifact)
        return {"waiting_reason": "user_review"}

    def graph(self, checkpointer: SqliteSaver):
        graph = StateGraph(WorkflowState)
        graph.add_node("evaluate", self.evaluate)
        graph.add_node("wait", self.wait)
        graph.add_node("publish", self.publish)
        graph.add_node("stage", self.stage)
        graph.add_edge(START, "evaluate")
        graph.add_conditional_edges("evaluate", self.route_evaluate, {"wait": "wait", "publish": "publish", "stage": "stage"})
        graph.add_edge("wait", END)
        graph.add_edge("publish", END)
        graph.add_edge("stage", END)
        return graph.compile(checkpointer=checkpointer)


def initial_state(task: sqlite3.Row) -> WorkflowState:
    return {
        "task_id": task["task_id"],
        "module": task["module"],
        "input_hash": task["input_hash"],
        "outcome": "score",
        "draft": "{}",
        "waiting_reason": None,
        "material_hash": "",
        "tool_calls": 0,
        "has_prior_package": False,
    }


def _run_task(
    directory: Path,
    task_id: str,
    *,
    start_state: WorkflowState | None = None,
    crash_at: str | None = None,
) -> dict:
    store = BusinessStore(directory / "opportunities.db")
    try:
        task = store.task(task_id)
        existing = store.result(task_id)
        if existing:
            return {"task_id": task_id, "status": "completed", "result": existing, "reconciled": True}
        if task["status"] == "cancelled":
            return {"task_id": task_id, "status": "cancelled", "reconciled": True}
        if task["status"] == "waiting" and not str(task["waiting_reason"] or "").startswith("failure:"):
            return {"task_id": task_id, "status": "waiting", "reason": task["waiting_reason"]}
        if task["workflow_version"] != WORKFLOW_VERSION:
            store.wait(task_id, "workflow_version_incompatible")
            return {"task_id": task_id, "status": "waiting", "reason": "workflow_version_incompatible"}
        runtime = Runtime(store, directory, crash_at)
        config = {"configurable": {"thread_id": f"{task_id}:{task['attempt']}"}}
        with SqliteSaver.from_conn_string(str(directory / "workflow-checkpoints.db")) as saver:
            graph = runtime.graph(saver)
            if start_state is None and task["status"] == "waiting" and (task["waiting_reason"] or "").startswith("failure:"):
                if graph.get_state(config).next:
                    store.resume_failed_checkpoint(task_id)
            if start_state is None and not graph.get_state(config).next:
                start_state = initial_state(task)
            value = graph.invoke(start_state, config)
        if value.get("waiting_reason"):
            store.wait(task_id, value["waiting_reason"])
            return {"task_id": task_id, "status": "waiting", "reason": value["waiting_reason"]}
        return {"task_id": task_id, "status": store.task(task_id)["status"], "result": store.result(task_id)}
    except TimeoutError as error:
        store.wait(task_id, str(error))
        return {"task_id": task_id, "status": "waiting", "reason": str(error)}
    except Exception as error:
        if store.task(task_id)["status"] == "running":
            store.wait(task_id, f"failure:{type(error).__name__}")
        raise
    finally:
        store.close()


def run_task(
    directory: Path,
    task_id: str,
    *,
    start_state: WorkflowState | None = None,
    crash_at: str | None = None,
) -> dict:
    """Run one task under a crash-safe process lock; business state remains authoritative."""
    lock_directory = directory / ".locks"
    lock_directory.mkdir(parents=True, exist_ok=True)
    with (lock_directory / f"{task_id}.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError(f"Task is already executing: {task_id}") from error
        return _run_task(directory, task_id, start_state=start_state, crash_at=crash_at)


def start_and_run(directory: Path, opportunity: str, module: str, input_text: str, crash_at: str | None, re_evaluate: bool = False) -> dict:
    if module == "scan":
        input_text = canonical_scan_input(input_text)
    store = BusinessStore(directory / "opportunities.db")
    if module == "score" and input_text.startswith("scan:"):
        scan = store.module_result(input_text.removeprefix("scan:"), "scan")
        if not scan or scan["outcome"] != "jd_report":
            store.close()
            raise ValueError("Missing completed scan result")
        input_text = score_inputs(scan["artifact"])
    elif module == "score":
        input_text = canonical_score_input(input_text)
    elif module == "apply" and input_text.startswith("score:"):
        upstream = input_text.removeprefix("score:")
        scan = store.module_result(upstream, "scan")
        score = store.module_result(upstream, "score")
        if not scan or scan["outcome"] != "jd_report" or not score or score["outcome"] != "score":
            store.close()
            raise ValueError("Missing current completed scan and score results")
        if score["input_hash"] != digest(score_inputs(scan["artifact"])):
            store.close()
            raise ValueError("Current score is stale for the scan or candidate inputs")
        input_text = apply_inputs(scan["artifact"], score, [])
    elif module == "apply":
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
    return run_task(directory, task["task_id"], start_state=initial_state(task), crash_at=crash_at)


def discovery_query(store: BusinessStore) -> tuple[str, str]:
    """Select the latest immutable capture and JD version for a discovered row."""
    has_source_evidence = bool(store.db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_evidence'"
    ).fetchone())
    has_page_versions = bool(store.db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_evidence_versions'"
    ).fetchone())
    capture_select = "(SELECT payload FROM source_evidence s WHERE s.opportunity_id=o.id ORDER BY s.id DESC LIMIT 1)" if has_source_evidence else "NULL"
    page_join = "LEFT JOIN page_evidence_versions p ON p.id=(SELECT id FROM page_evidence_versions v WHERE v.opportunity_id=o.id ORDER BY v.id DESC LIMIT 1)" if has_page_versions else "LEFT JOIN page_evidence p ON p.opportunity_id=o.id"
    return capture_select, page_join


def same_posting_url(requested: str, final: str) -> bool:
    """Accept IBM's locale redirect only when the public job ID is unchanged."""
    if requested == final:
        return True
    try:
        source, target = urlsplit(requested), urlsplit(final)
        source_query = parse_qs(source.query, keep_blank_values=True)
        target_query = parse_qs(target.query, keep_blank_values=True)
        return (source.scheme == target.scheme == "https"
                and source.netloc == target.netloc == "careers.ibm.com"
                and source.path == "/careers/JobDetail"
                and re.fullmatch(r"/[a-z]{2}_[A-Z]{2}/careers/JobDetail", target.path) is not None
                and not source.fragment and not target.fragment
                and len(source_query) == len(target_query) == 1
                and len(source_query.get("jobId", [])) == len(target_query.get("jobId", [])) == 1
                and re.fullmatch(r"\d+", source_query.get("jobId", [""])[0]) is not None
                and source_query == target_query)
    except (TypeError, ValueError):
        return False


def discovered_scan_source(opportunity: sqlite3.Row, refreshed: dict | None = None) -> dict:
    """Build one scan input only from a current, identity-bound source capture."""
    opportunity_id = str(opportunity["id"])
    capture = json.loads(opportunity["capture_payload"]) if opportunity["capture_payload"] else {}
    snapshot = (
        {"text": refreshed["text"], "retrieved_at": refreshed["retrieved_at"],
         "final_url": refreshed["url"], "content_hash": digest(refreshed["text"])}
        if refreshed and refreshed.get("status") == "captured"
        else capture.get("scan_jd") or {}
    )
    metadata = capture.get("_capture", {})
    jd = snapshot.get("text") or opportunity["content"] or ""
    captured_at = snapshot.get("retrieved_at") or metadata.get("retrieved_at", "")
    try:
        capture_age = (datetime.now(timezone.utc) - datetime.fromisoformat(captured_at.replace("Z", "+00:00"))).total_seconds()
    except (TypeError, ValueError):
        capture_age = float("inf")
    current_snapshot = (
        (refreshed is not None or (capture.get("url") or metadata.get("url")) == opportunity["url"])
        and same_posting_url(opportunity["url"], snapshot.get("final_url"))
        and isinstance(snapshot.get("text"), str)
        and snapshot.get("content_hash") == digest(snapshot["text"])
        and 0 <= capture_age < 86400
    )
    current_capture = current_snapshot or (
        metadata.get("method") in {"workday_cxs_api", "oraclecloud_detail_api", "smartrecruiters_detail_api", "successfactors_job_page", "phenom_job_page", "beesite_job_page", "ikea_job_page", "jibeapply_job_page", "avature_job_page", "eightfold_job_page", "mtr_taleo_job_page", "official_job_page", "browser_snapshot"}
        and metadata.get("status") == 200
        and metadata.get("url") == opportunity["url"]
        and metadata.get("content_hash") == digest(jd)
        and 0 <= capture_age < 86400
    )
    evidence = (
        {"method": "browser_snapshot", "status": "captured", "url": opportunity["url"],
         "final_url": snapshot.get("final_url"), "content_hash": snapshot.get("content_hash")}
        if current_snapshot else metadata if current_capture else {"reason": "No current verified source capture"}
    )
    return {
        "schema_version": "scan_input_v1", "opportunity_id": opportunity_id,
        "source_contract_version": 3,
        "url": opportunity["url"], "company": opportunity["company"], "role": opportunity["role"],
        "captured_at": captured_at or opportunity["captured_at"] or time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "capture_method": "browser_snapshot" if current_snapshot else metadata.get("method", "unknown"),
        "liveness": "active" if current_capture else "uncertain",
        "liveness_evidence": evidence,
        "location_evidence": capture.get("structured_posting", {}).get("jobLocation")
            or capture.get("jobPostingInfo", {}).get("location") or capture.get("location"),
        "employment_evidence": capture.get("structured_posting", {}).get("employmentType"),
        "jd": jd,
    }


def current_discovered_scan_source(opportunity: sqlite3.Row, directory: Path) -> dict:
    """Keep stale or missing evidence Unknown unless one guarded refresh succeeds."""
    source = discovered_scan_source(opportunity)
    if source["liveness"] == "active":
        return source
    refreshed = capture_jd(directory, opportunity["url"])
    return discovered_scan_source(opportunity, refreshed) if refreshed else source


def scan_discovered(directory: Path, opportunity_id: str, re_evaluate: bool = False) -> dict:
    """Start the scan graph from a retained provider capture by opportunity ID."""
    store = BusinessStore(directory / "opportunities.db")
    try:
        capture_select, page_join = discovery_query(store)
        row = store.db.execute(
            f"SELECT o.id,o.url,o.company,o.role,p.content,p.captured_at,{capture_select} AS capture_payload "
            f"FROM opportunities o {page_join} WHERE o.id=?", (opportunity_id,),
        ).fetchone()
        if not row:
            raise ValueError(f"Discovered opportunity not found: {opportunity_id}")
        source = current_discovered_scan_source(row, directory)
        waiting = store.db.execute(
            "SELECT task_id,input_hash FROM tasks WHERE opportunity_id=? AND module='scan' "
            "AND status='waiting' AND waiting_reason='source_access_unknown' ORDER BY rowid DESC LIMIT 1",
            (opportunity_id,),
        ).fetchone()
    finally:
        store.close()
    input_text = json.dumps(source, ensure_ascii=False)
    if waiting:
        if source["liveness"] == "active" and digest(canonical_scan_input(input_text)) != waiting["input_hash"]:
            return resume_task(directory, waiting["task_id"], input_text, None)
        return view(directory, waiting["task_id"])
    return start_and_run(directory, opportunity_id, "scan", input_text, None, re_evaluate)


def cron_score(directory: Path) -> dict:
    """Advance at most one discovered scanner record through scan and score."""
    store = BusinessStore(directory / "opportunities.db")
    try:
        if not store.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='opportunities'").fetchone():
            return {"status": "idle", "reason": "scanner_store_not_initialized"}
        capture_select, page_join = discovery_query(store)
        opportunity = store.db.execute(
            f"""
            SELECT o.id,o.url,o.company,o.role,p.content,p.captured_at,{capture_select} AS capture_payload
            FROM opportunities o
            {page_join}
            WHERE NOT EXISTS (
              SELECT 1 FROM results r
              WHERE r.opportunity_id=CAST(o.id AS TEXT) AND r.module='score'
            )
            AND NOT EXISTS (
              SELECT 1 FROM results r
              WHERE r.opportunity_id=CAST(o.id AS TEXT) AND r.module='scan'
                AND json_extract(r.payload,'$.outcome')='exclude'
            )
            AND NOT EXISTS (
              SELECT 1 FROM tasks t
              WHERE t.opportunity_id=CAST(o.id AS TEXT) AND t.status='waiting'
                AND NOT (t.module='scan' AND t.waiting_reason='source_access_unknown')
                AND NOT (t.waiting_reason LIKE 'failure:%' AND t.attempt<2)
            )
            ORDER BY EXISTS(
              SELECT 1 FROM tasks t WHERE t.opportunity_id=CAST(o.id AS TEXT)
                AND t.status='waiting' AND t.waiting_reason LIKE 'failure:%'
            ), EXISTS(
              SELECT 1 FROM tasks t WHERE t.opportunity_id=CAST(o.id AS TEXT)
                AND t.status='waiting' AND t.module='scan'
            ), COALESCE((
              SELECT json_extract(c.payload,'$.at') FROM tasks t
              JOIN task_context c ON c.task_id=t.task_id AND c.key='source_probe'
              WHERE t.opportunity_id=CAST(o.id AS TEXT) AND t.status='waiting' AND t.module='scan'
            ), ''), o.id LIMIT 1
            """
        ).fetchone()
        if not opportunity:
            return {"status": "idle", "reason": "no_unscored_opportunities"}
        opportunity_id = str(opportunity["id"])
        scan = store.module_result(opportunity_id, "scan")
        active = store.db.execute(
            "SELECT task_id,module,status,waiting_reason,input_hash FROM tasks WHERE opportunity_id=? AND status IN ('running','waiting')",
            (opportunity_id,),
        ).fetchone()
    finally:
        store.close()
    if active:
        if active["status"] == "waiting" and active["waiting_reason"].startswith("failure:"):
            result = resume_task(directory, active["task_id"], None, None)
            return {"status": "advanced", "opportunity_id": opportunity_id, "task": result}
        if active["status"] == "waiting" and active["module"] == "scan" and active["waiting_reason"] == "source_access_unknown":
            source = current_discovered_scan_source(opportunity, directory)
            input_text = json.dumps(source, ensure_ascii=False)
            if source["liveness"] != "active" or digest(canonical_scan_input(input_text)) == active["input_hash"]:
                store = BusinessStore(directory / "opportunities.db")
                try:
                    store.set_context(active["task_id"], "source_probe", {"at": datetime.now(timezone.utc).isoformat()})
                finally:
                    store.close()
                return {"status": "waiting", "opportunity_id": opportunity_id, "reason": "source_access_unknown"}
            result = resume_task(directory, active["task_id"], input_text, None)
            return {"status": "advanced", "opportunity_id": opportunity_id, "task": result}
        result = run_task(directory, active["task_id"])
        return {"status": "advanced", "opportunity_id": opportunity_id, "task": result}
    if not scan:
        result = start_and_run(directory, opportunity_id, "scan", json.dumps(current_discovered_scan_source(opportunity, directory), ensure_ascii=False), None)
        return {"status": "advanced", "opportunity_id": opportunity_id, "task": result}
    if scan["outcome"] == "exclude":
        return {"status": "complete", "opportunity_id": opportunity_id, "outcome": "exclude"}
    result = start_and_run(directory, opportunity_id, "score", f"scan:{opportunity_id}", None)
    return {"status": "advanced", "opportunity_id": opportunity_id, "task": result}


def resume_task(
    directory: Path,
    task_id: str,
    input_text: str | None,
    crash_at: str | None,
    *,
    feedback: str | None = None,
    decision: str | None = None,
) -> dict:
    store = BusinessStore(directory / "opportunities.db")
    task = store.task(task_id)
    if task["module"] == "apply":
        if task["status"] == "completed" and decision == "confirm":
            store.confirm_apply(task_id, current_apply_input(store, task))
            store.close()
            return {"task_id": task_id, "status": "completed"}
        if task["status"] in ("completed", "cancelled"):
            store.close()
            raise ValueError(f"Terminal task cannot resume: {task['status']}")
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
            store.db.execute("BEGIN IMMEDIATE")
            try:
                task = store.task(task_id)
                if task["status"] != "waiting":
                    raise ValueError("Apply task is no longer waiting")
                change = store.context(task_id, "input_change")
                if not change:
                    raise ValueError("No pending JD change")
                input_text = current_apply_input(store, task, change["jd_report"])
                store.clear_context(task_id, "input_change")
                task = store.reset_input(task_id, input_text)
                store.db.execute("COMMIT")
            except Exception:
                store.db.execute("ROLLBACK")
                store.close()
                raise
            store.close()
            return run_task(directory, task_id, start_state=initial_state(task), crash_at=crash_at)
        if feedback is not None:
            store.db.execute("BEGIN IMMEDIATE")
            try:
                task = store.task(task_id)
                if task["status"] != "waiting":
                    raise ValueError("Apply task is no longer waiting")
                if store.context(task_id, "input_change"):
                    raise ValueError("Resolve the pending JD change before feedback")
                previous = store.draft(task_id)
                store.add_feedback(task_id, feedback)
                input_text = current_apply_input(store, task)
                new_inputs = json.loads(input_text)
                feedbacks = new_inputs.get("feedback", [])
                reuse_previous = bool(previous and any(
                    digest(json.dumps({**new_inputs, "feedback": feedbacks[:index]}, ensure_ascii=False,
                                      sort_keys=True, separators=(",", ":"))) == previous["input_hash"]
                    for index in range(len(feedbacks))
                ))
                task = store.reset_input(task_id, input_text)
                store.db.execute("COMMIT")
            except Exception:
                store.db.execute("ROLLBACK")
                store.close()
                raise
            store.close()
            state = initial_state(task)
            if reuse_previous:
                state.update(
                    draft=json.dumps(previous["package"], ensure_ascii=False, sort_keys=True),
                    has_prior_package=True,
                )
            return run_task(directory, task_id, start_state=state, crash_at=crash_at)
        if task["status"] == "waiting" and str(task["waiting_reason"] or "").startswith("failure:"):
            store.resume_failed_checkpoint(task_id)
            store.close()
            return run_task(directory, task_id, crash_at=crash_at)
        store.close()
        raise ValueError("apply resume requires --feedback, --input, or --decision")
    if task["status"] in ("completed", "cancelled"):
        store.close()
        raise ValueError(f"Terminal task cannot resume: {task['status']}")
    if input_text is not None:
        input_text = canonical_scan_input(input_text) if task["module"] == "scan" else canonical_score_input(input_text)
        if task["module"] == "scan":
            store.retain_source(task["opportunity_id"], input_text)
    if input_text is not None:
        task = store.reset_input(task_id, input_text)
    elif task["status"] == "waiting":
        task = store.resume_current(task_id)
    store.close()
    return run_task(directory, task_id, start_state=initial_state(task), crash_at=crash_at)


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser()
    cli.add_argument("--directory", type=Path, default=ROOT / "data")
    commands = cli.add_subparsers(dest="command", required=True)
    start = commands.add_parser("start")
    start.add_argument("module", choices=("scan", "score", "apply"))
    start.add_argument("opportunity")
    start.add_argument("input")
    start.add_argument("--crash-at", choices=("before_publish", "publish"), help=argparse.SUPPRESS)
    start.add_argument("--re-evaluate", action="store_true")
    run = commands.add_parser("run")
    run.add_argument("task_id")
    run.add_argument("--state", help=argparse.SUPPRESS)
    run.add_argument("--crash-at", choices=("before_publish", "publish"), help=argparse.SUPPRESS)
    cron = commands.add_parser("cron-score")
    discover_command = commands.add_parser("discover")
    discover_command.add_argument("--company")
    discover_command.add_argument("--verify", action="store_true")
    discover_command.add_argument("--headed-fallback", action="store_true")
    discover_command.add_argument("--throttle", nargs="?", type=int, const=5000)
    discover_command.add_argument("--rediscover-404", action="store_true")
    discover_command.add_argument("--posted-after")
    discover_command.add_argument("--posted-before")
    discover_command.add_argument("--since", type=float)
    discover_command.add_argument("--include-blacklisted", action="store_true")
    discover_command.add_argument("--dry-run", action="store_true")
    discover_command.add_argument("--resume", action="store_true")
    global_command = commands.add_parser("global")
    global_command.add_argument("--ats")
    global_command.add_argument("--seeds")
    global_command.add_argument("--liveness", action="store_true")
    global_command.add_argument("--md-out")
    global_command.add_argument("--verbose", action="store_true")
    global_command.add_argument("--since", type=float, default=3)
    global_command.add_argument("--limit", type=int)
    global_command.add_argument("--include-undated", action="store_true")
    global_command.add_argument("--include-blacklisted", action="store_true")
    global_command.add_argument("--shuffle", action="store_true")
    global_command.add_argument("--resume", action="store_true")
    global_command.add_argument("--dry-run", action="store_true")
    global_command.add_argument("--json", action="store_true")
    resolve_command = commands.add_parser("resolve-company", aliases=["resolve"])
    resolve_command.add_argument("names", nargs="*")
    resolve_command.add_argument("--in", dest="input_path", type=Path)
    resolve_command.add_argument("--vendors")
    resolve_command.add_argument("--write", action="store_true")
    resolve_command.add_argument("--dry-run", action="store_true")
    resolve_command.add_argument("--summary", action="store_true")
    scan_discovered_command = commands.add_parser("scan-discovered")
    scan_discovered_command.add_argument("opportunity")
    scan_discovered_command.add_argument("--re-evaluate", action="store_true")
    resume = commands.add_parser("resume")
    resume.add_argument("task_id")
    resume.add_argument("--input")
    resume.add_argument("--feedback")
    resume.add_argument("--decision", choices=("confirm", "defer", "accept-jd-change"))
    resume.add_argument("--crash-at", choices=("before_publish", "publish"), help=argparse.SUPPRESS)
    show = commands.add_parser("show")
    show.add_argument("identifier")
    commands.add_parser("list")
    commands.add_parser("scores")
    cancel = commands.add_parser("cancel")
    cancel.add_argument("task_id")
    application = commands.add_parser("application")
    application.add_argument("action", choices=("submit", "transition", "activity", "outcome", "schedule", "retire", "reopen", "view", "followups"))
    application.add_argument("opportunity", nargs="?")
    application.add_argument("value", nargs="?")
    application.add_argument("--source")
    application.add_argument("--confirmed", action="store_true")
    application.add_argument("--payload", default="{}")
    application.add_argument("--idempotency-key")
    application.add_argument("--overdue-only", action="store_true")
    application.add_argument("--applied-days", type=int)
    reply = commands.add_parser("reply")
    reply.add_argument("action", choices=("import", "paste", "view", "confirm"))
    reply.add_argument("value", nargs="?")
    reply.add_argument("--opportunity")
    reply.add_argument("--status", choices=("responded", "interview", "offer", "rejected"))
    reply.add_argument("--reason", default="")
    reply.add_argument("--confirmed", action="store_true")
    insights = commands.add_parser("insights")
    insights.add_argument("kind", choices=("stats", "reposts", "company", "company-signals", "salary", "stated", "upskill", "jd-skill-gap", "preparation-plan"))
    insights.add_argument("--company")
    insights.add_argument("--silence-days", type=int, default=28)
    insights.add_argument("--include-stale", action="store_true")
    insights.add_argument("--min-reports", type=int, default=5)
    insights.add_argument("--jd", type=Path)
    insights.add_argument("--jd-url")
    insights.add_argument("--opportunity")
    insights.add_argument("--role")
    insights.add_argument("--report", type=Path)
    insights.add_argument("--output", type=Path)
    salary = commands.add_parser("salary")
    salary.add_argument("action", choices=("record",))
    salary.add_argument("observation", help="JSON object or path to JSON file")
    salary.add_argument("--idempotency-key", required=True)
    salary.add_argument("--confirmed", action="store_true")
    return cli


def main() -> None:
    cli = parser()
    argv = sys.argv[1:]
    since_count = sum(arg == "--since" or arg.startswith("--since=") for arg in argv)
    if since_count > 1:
        cli.error(f"--since given {since_count} times; pass it once")
    args = cli.parse_args(argv)
    try:
        if args.command == "start":
            args.directory.mkdir(parents=True, exist_ok=True)
            started = start_and_run(args.directory, args.opportunity, args.module, args.input, args.crash_at, args.re_evaluate)
            result = view(args.directory, started["task_id"])
        elif args.command == "run":
            run_task(args.directory, args.task_id, start_state=json.loads(args.state) if args.state else None, crash_at=args.crash_at)
            result = view(args.directory, args.task_id)
        elif args.command == "cron-score":
            result = cron_score(args.directory)
        elif args.command == "discover":
            if args.company == "":
                raise ValueError("--company requires a value")
            result = discover(args.directory, Path(os.environ.get("CAREER_OPS_PORTALS") or INPUT_ROOT / "portals.yml"),
                              company_filter=args.company,
                              verify=args.verify, headed_fallback=args.headed_fallback,
                              throttle_ms=5000 if args.throttle == 0 else args.throttle or 0,
                              rediscover_404=args.rediscover_404,
                              posted_after=args.posted_after, posted_before=args.posted_before,
                              since_days=args.since, include_blacklisted=args.include_blacklisted,
                              dry_run=args.dry_run, resume=args.resume, input_root=INPUT_ROOT,
                              profile_path=Path(os.environ.get("CAREER_OPS_PROFILE") or INPUT_ROOT / "config" / "profile.yml"))
            if result["status"] == "failed":
                raise RuntimeError(json.dumps(result, ensure_ascii=False, sort_keys=True))
        elif args.command == "global":
            result = discover_global(args.directory, Path(os.environ.get("CAREER_OPS_PORTALS") or INPUT_ROOT / "portals.yml"),
                                     ats=[part.strip().lower() for part in args.ats.split(",") if part.strip()] if args.ats else None,
                                     seeds=[part.strip().lower() for part in args.seeds.split(",") if part.strip()] if args.seeds else None,
                                     liveness=args.liveness, md_out=Path(args.md_out) if args.md_out else None, verbose=args.verbose,
                                     since_days=args.since, limit=args.limit or None,
                                     include_undated=args.include_undated,
                                     include_blacklisted=args.include_blacklisted,
                                     shuffle=args.shuffle, resume=args.resume, dry_run=args.dry_run,
                                     input_root=INPUT_ROOT)
        elif args.command in {"resolve", "resolve-company"}:
            requested = tuple(part.strip().lower() for part in args.vendors.split(",") if part.strip()) if args.vendors else (*VENDOR_ORDER, "workday")
            result = resolve_boards(Path(os.environ.get("CAREER_OPS_PORTALS") or INPUT_ROOT / "portals.yml"),
                                    input_path=args.input_path, names=args.names,
                                    vendors=tuple(vendor for vendor in requested if vendor != "workday"),
                                    include_workday="workday" in requested, write=args.write)
        elif args.command == "scan-discovered":
            started = scan_discovered(args.directory, args.opportunity, args.re_evaluate)
            result = view(args.directory, started["task_id"])
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
        elif args.command == "scores":
            store = BusinessStore(args.directory / "opportunities.db")
            try:
                result = store.score_views()
            finally:
                store.close()
        elif args.command == "insights":
            if args.kind in {"jd-skill-gap", "preparation-plan"}:
                if bool(args.jd) == bool(args.jd_url):
                    raise ValueError("JD analysis requires exactly one of --jd or --jd-url")
                if args.jd:
                    jd = args.jd.read_text()
                else:
                    with tempfile.TemporaryDirectory(prefix="career-ops-jd-gap-") as temporary:
                        snapshot = capture_jd(Path(temporary), args.jd_url)
                    if not snapshot:
                        raise ValueError("JD URL capture failed or was blocked")
                    jd = snapshot["text"]
                if args.kind == "jd-skill-gap":
                    result = targeted_skill_gap(jd, (INPUT_ROOT / "cv.md").read_text())
                else:
                    if not args.company or not args.role:
                        raise ValueError("preparation-plan requires --company and --role")
                    result = build_preparation_plan(
                        args.company, args.role, jd, (INPUT_ROOT / "cv.md").read_text(),
                        (INPUT_ROOT / "config" / "profile.yml").read_text(),
                        args.report.read_text() if args.report else "",
                        sources={"jd": str(args.jd) if args.jd else args.jd_url,
                                 "report": str(args.report) if args.report else None})
                    if args.output:
                        args.output.parent.mkdir(parents=True, exist_ok=True)
                        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
            else:
                database = (args.directory / "opportunities.db").resolve()
                with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as db:
                    db.row_factory = sqlite3.Row
                    portals = INPUT_ROOT / "portals.yml"
                    if args.kind == "stats":
                        result = stats_view(db, portals, INPUT_ROOT / "config" / "profile.yml")
                    elif args.kind == "reposts":
                        result = repost_view(db, portals)
                    elif args.kind == "salary":
                        result = salary_view(db, INPUT_ROOT / "config" / "profile.yml")
                    elif args.kind == "stated":
                        if not args.opportunity:
                            raise ValueError("insights stated requires --opportunity")
                        result = stated_view(db, args.opportunity)
                    elif args.kind == "upskill":
                        result = upskill_view(db, INPUT_ROOT / "cv.md", min_reports=args.min_reports)
                    else:
                        view_result = company_view(db, portals, silence_days=args.silence_days,
                                                   include_stale=args.include_stale, company=args.company)
                        result = company_signals(view_result, INPUT_ROOT / "config" / "profile.yml",
                                                 INPUT_ROOT / "package.json", include_stale=args.include_stale) if args.kind == "company-signals" else view_result
        elif args.command == "salary":
            if not args.confirmed:
                raise ValueError("salary record requires --confirmed")
            raw = args.observation if args.observation.lstrip().startswith("{") else Path(args.observation).read_text()
            result = record_salary(args.directory, json.loads(raw), args.idempotency_key)
        elif args.command == "cancel":
            result = cancel_task(args.directory, args.task_id)
        elif args.command == "reply":
            if args.action == "paste":
                if args.value:
                    raw = Path(args.value).read_text()
                else:
                    print("Subject: ", end="", file=sys.stderr, flush=True)
                    subject = sys.stdin.readline().rstrip("\n")
                    print("From: ", end="", file=sys.stderr, flush=True)
                    sender = sys.stdin.readline().rstrip("\n")
                    print("Body (finish with Ctrl-D):", file=sys.stderr)
                    raw = f"Subject: {subject}\nFrom: {sender}\n\n" + sys.stdin.read()
                result = import_reply(args.directory, parse_pasted(raw))
            elif args.action == "import":
                if not args.value:
                    raise ValueError("reply import requires a JSON object or file")
                if args.value.lstrip().startswith(("{", "[")):
                    message = json.loads(args.value)
                else:
                    raw = Path(args.value).read_text()
                    message = json.loads(raw) if raw.lstrip().startswith(("{", "[")) else parse_pasted(raw)
                result = [import_reply(args.directory, item) for item in message] if isinstance(message, list) else import_reply(args.directory, message)
            elif args.action == "view":
                if not args.value:
                    raise ValueError("reply view requires a message ID")
                result = view_reply(args.directory, args.value)
            else:
                if not args.value or not args.confirmed or not args.opportunity or not args.status:
                    raise ValueError("reply confirm requires --confirmed, --opportunity and --status")
                result = confirm_reply(args.directory, args.value, args.opportunity, args.status, reason=args.reason)
        elif args.command == "application":
            store = ApplicationStore(args.directory / "opportunities.db")
            try:
                if args.action == "view":
                    result = store.application(args.opportunity) if args.opportunity else store.views()
                elif args.action == "followups":
                    result = store.followups(overdue_only=args.overdue_only, applied_days=args.applied_days)
                else:
                    if not args.opportunity or (args.action in {"transition", "activity", "outcome", "schedule"} and not args.value):
                        raise ValueError("application mutation requires opportunity and value")
                    if not args.idempotency_key:
                        raise ValueError("application mutation requires --idempotency-key")
                    if args.action in {"submit", "transition", "activity", "outcome", "schedule", "retire", "reopen"} and not args.confirmed:
                        raise ValueError(f"application {args.action} requires --confirmed")
                    if args.action in {"transition", "outcome"} and not (args.source or "").strip():
                        raise ValueError(f"application {args.action} requires --source")
                    store.close()
                    store = None
                    result = mutate_application(
                        args.directory, args.opportunity, args.action, args.value or "",
                        source=args.source if args.source is not None else "candidate-confirmed",
                        payload=json.loads(args.payload), idempotency_key=args.idempotency_key,
                    )
            finally:
                if store:
                    store.close()
        if args.command in {"resolve", "resolve-company"} and args.summary:
            print(format_summary(result))
        else:
            print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
