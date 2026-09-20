"""Run the local LangGraph workflow behind the Career Ops JSON CLI."""

from __future__ import annotations

import argparse
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
        "cv": (ROOT / "cv.md").read_text(),
        "profile": (ROOT / "config" / "profile.yml").read_text(),
        "targeting": (ROOT / "modes" / "_profile.md").read_text(),
        "rules": (ROOT / "modes" / "_custom.md").read_text(),
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
        "cv": (ROOT / "cv.md").read_text(),
        "profile": (ROOT / "config" / "profile.yml").read_text(),
        "targeting": (ROOT / "modes" / "_profile.md").read_text(),
        "rules": (ROOT / "modes" / "_custom.md").read_text(),
    }
    return json.dumps(inputs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class WorkflowState(TypedDict):
    task_id: str
    module: Literal["scan", "score"]
    input_hash: str
    required_corrections: int
    revision: int
    outcome: Literal["jd_report", "score", "exclude"]
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
        self.db.executescript(
            """
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS tasks (
              task_id TEXT PRIMARY KEY,
              opportunity_id TEXT NOT NULL,
              module TEXT NOT NULL CHECK(module IN ('scan','score')),
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
    reason = task["waiting_reason"]
    return {
        "task_id": task["task_id"],
        "opportunity_id": task["opportunity_id"],
        "module": task["module"],
        "status": task["status"],
        "reason": reason,
        "artifact": result,
        "attempt": task["attempt"],
        "allowed_actions": ["resume", "cancel"] if task["status"] == "waiting" else [],
    }


def view(directory: Path, identifier: str) -> dict:
    store = BusinessStore(directory / "business.db")
    try:
        return task_view(store, store.find_task(identifier))
    finally:
        store.close()


def list_views(directory: Path) -> list[dict]:
    store = BusinessStore(directory / "business.db")
    try:
        return [task_view(store, task) for task in store.list_tasks()]
    finally:
        store.close()


def cancel_task(directory: Path, task_id: str) -> dict:
    store = BusinessStore(directory / "business.db")
    try:
        return task_view(store, store.cancel(task_id))
    finally:
        store.close()


class Runtime:
    """Build one explicit graph while keeping formal writes behind BusinessStore."""

    def __init__(self, store: BusinessStore, fault_dir: Path, crash_at: str | None = None):
        self.store = store
        self.fault_dir = fault_dir
        self.crash_at = crash_at

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
                remaining = 900 - (time.monotonic() - state["started_at"])
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
        if task["input_payload"].startswith("{"):
            decision = self.run_model(
                "scan_review" if task["module"] == "scan" else "review",
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
            return "publish"
        return "wait_review" if state["revision"] > MAX_CORRECTIONS else "evaluate"

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

    def graph(self, checkpointer: SqliteSaver):
        graph = StateGraph(WorkflowState)
        graph.add_node("evaluate", self.evaluate)
        graph.add_node("review", self.review)
        graph.add_node("wait_review", self.wait_review)
        graph.add_node("publish", self.publish)
        graph.add_edge(START, "evaluate")
        graph.add_conditional_edges("evaluate", self.route_evaluate, {"wait": "wait_review", "review": "review"})
        graph.add_conditional_edges(
            "review",
            self.route_review,
            {"evaluate": "evaluate", "wait_review": "wait_review", "publish": "publish"},
        )
        graph.add_edge("wait_review", END)
        graph.add_edge("publish", END)
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
    elif input_text.startswith("scan:"):
        scan = store.module_result(input_text.removeprefix("scan:"), "scan")
        if not scan or scan["outcome"] != "jd_report":
            store.close()
            raise ValueError("Missing reviewed scan result")
        input_text = score_inputs(scan["artifact"])
    else:
        input_text = canonical_score_input(input_text)
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


def resume_task(directory: Path, task_id: str, input_text: str | None, crash_at: str | None) -> dict:
    store = BusinessStore(directory / "business.db")
    task = store.task(task_id)
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
    start.add_argument("module", choices=("scan", "score"))
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
            resume_task(args.directory, args.task_id, args.input, args.crash_at)
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
