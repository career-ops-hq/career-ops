"""Disposable OII-325 proof of workflow recovery and business idempotency boundaries."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Literal, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

os.environ.setdefault("LANGGRAPH_STRICT_MSGPACK", "true")

WORKFLOW_VERSION = "oii-325-v1"
MAX_CORRECTIONS = 2


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class WorkflowState(TypedDict):
    task_id: str
    module: Literal["score", "apply"]
    input_hash: str
    required_corrections: int
    revision: int
    outcome: Literal["score", "exclude"]
    draft: str
    review_approved: bool
    waiting_reason: str | None
    material_hash: str
    confirmed: bool


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
              module TEXT NOT NULL CHECK(module IN ('score','apply')),
              status TEXT NOT NULL CHECK(status IN ('running','waiting','completed','cancelled')),
              input_hash TEXT NOT NULL,
              attempt INTEGER NOT NULL DEFAULT 1,
              waiting_reason TEXT,
              workflow_version TEXT NOT NULL
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
            """
        )

    def close(self) -> None:
        self.db.close()

    def start(self, opportunity_id: str, module: str, input_text: str) -> dict:
        input_hash = digest(input_text)
        reused = self.db.execute(
            "SELECT task_id FROM results WHERE opportunity_id=? AND module=? AND input_hash=?",
            (opportunity_id, module, input_hash),
        ).fetchone()
        if reused:
            return {"task_id": reused["task_id"], "status": "completed", "reused": True}
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
                "INSERT INTO tasks(task_id,opportunity_id,module,status,input_hash,workflow_version) VALUES(?,?,?,'running',?,?)",
                (task_id, opportunity_id, module, input_hash, WORKFLOW_VERSION),
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
                "UPDATE tasks SET input_hash=?,attempt=attempt+1,status='running',waiting_reason=NULL WHERE task_id=?",
                (input_hash, task_id),
            )
        return self.task(task_id)

    def resume_current(self, task_id: str) -> sqlite3.Row:
        self.db.execute("UPDATE tasks SET status='running',waiting_reason=NULL WHERE task_id=? AND status='waiting'", (task_id,))
        return self.task(task_id)

    def publish(self, state: WorkflowState) -> dict:
        task = self.task(state["task_id"])
        if task["input_hash"] != state["input_hash"]:
            self.wait(state["task_id"], "input_changed")
            raise ValueError("Input changed before business commit")
        if task["module"] == "apply" and not state["confirmed"]:
            raise ValueError("Current material version is not confirmed")
        payload = {
            "module": task["module"],
            "outcome": state["outcome"],
            "draft": state["draft"],
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

    def evaluate(self, state: WorkflowState) -> dict:
        if state["draft"] == "raise":
            raise RuntimeError("injected single-job failure")
        outcome = "exclude" if state["draft"] == "exclude" else "score"
        return {
            "outcome": outcome,
            "draft": f"{outcome}-result-r{state['revision']}",
            "material_hash": digest(f"{state['module']}:{state['input_hash']}:r{state['revision']}"),
        }

    def review(self, state: WorkflowState) -> dict:
        self.crash_once(state, "review")
        approved = state["revision"] >= state["required_corrections"]
        return {"review_approved": approved, "revision": state["revision"] + (0 if approved else 1)}

    @staticmethod
    def route_review(state: WorkflowState) -> str:
        if state["review_approved"]:
            return "confirm" if state["module"] == "apply" else "publish"
        return "wait_review" if state["revision"] > MAX_CORRECTIONS else "evaluate"

    @staticmethod
    def wait_review(state: WorkflowState) -> dict:
        return {"waiting_reason": "review_budget_exhausted"}

    @staticmethod
    def confirm(state: WorkflowState) -> dict:
        answer = interrupt(
            {
                "action": "confirm_materials",
                "input_hash": state["input_hash"],
                "material_hash": state["material_hash"],
            }
        )
        confirmed = (
            isinstance(answer, dict)
            and answer.get("action") == "confirm"
            and answer.get("input_hash") == state["input_hash"]
            and answer.get("material_hash") == state["material_hash"]
        )
        if not confirmed:
            raise ValueError("Confirmation does not match current inputs and material")
        return {"confirmed": True}

    def publish(self, state: WorkflowState) -> dict:
        payload = self.store.result(state["task_id"]) or self.store.publish(state)
        self.crash_once(state, "publish")
        return {"waiting_reason": None, "draft": payload["draft"]}

    def graph(self, checkpointer: SqliteSaver):
        graph = StateGraph(WorkflowState)
        graph.add_node("evaluate", self.evaluate)
        graph.add_node("review", self.review)
        graph.add_node("wait_review", self.wait_review)
        graph.add_node("confirm", self.confirm)
        graph.add_node("publish", self.publish)
        graph.add_edge(START, "evaluate")
        graph.add_edge("evaluate", "review")
        graph.add_conditional_edges(
            "review",
            self.route_review,
            {"evaluate": "evaluate", "wait_review": "wait_review", "confirm": "confirm", "publish": "publish"},
        )
        graph.add_edge("wait_review", END)
        graph.add_edge("confirm", "publish")
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
        "waiting_reason": None,
        "material_hash": "",
        "confirmed": False,
    }


def run_task(
    directory: Path,
    task_id: str,
    *,
    start_state: WorkflowState | None = None,
    resume: dict | None = None,
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
            value = graph.invoke(Command(resume=resume) if resume is not None else start_state, config)
        if value.get("__interrupt__"):
            payload = value["__interrupt__"][0].value
            store.wait(task_id, "human_confirmation")
            return {"task_id": task_id, "status": "waiting", "reason": "human_confirmation", "interrupt": payload}
        if value.get("waiting_reason"):
            store.wait(task_id, value["waiting_reason"])
            return {"task_id": task_id, "status": "waiting", "reason": value["waiting_reason"]}
        return {"task_id": task_id, "status": store.task(task_id)["status"], "result": store.result(task_id)}
    except Exception as error:
        store.wait(task_id, f"failure:{type(error).__name__}")
        raise
    finally:
        store.close()


def start_and_run(directory: Path, opportunity: str, module: str, input_text: str, corrections: int, scenario: str, crash_at: str | None) -> dict:
    store = BusinessStore(directory / "business.db")
    started = store.start(opportunity, module, input_text)
    task = store.task(started["task_id"])
    store.close()
    if started["status"] != "running":
        return started
    return run_task(directory, task["task_id"], start_state=initial_state(task, corrections, scenario), crash_at=crash_at)


def resume_task(directory: Path, task_id: str, input_text: str | None, confirmation: dict | None, crash_at: str | None) -> dict:
    store = BusinessStore(directory / "business.db")
    task = store.task(task_id)
    changed = input_text is not None and digest(input_text) != task["input_hash"]
    if input_text is not None:
        task = store.reset_input(task_id, input_text)
    elif task["status"] == "waiting":
        task = store.resume_current(task_id)
    store.close()
    if changed:
        return run_task(directory, task_id, start_state=initial_state(task, 0, "normal"), crash_at=crash_at)
    return run_task(directory, task_id, resume=confirmation, crash_at=crash_at)


def model_smoke(directory: Path) -> dict:
    """Run one real required tool call inside a persisted LangGraph node."""
    from openai import OpenAI

    client = OpenAI(api_key=os.environ["MODEL_API_KEY"], base_url=os.environ["MODEL_BASE_URL"])
    model = os.environ["MODEL_NAME"]

    class SmokeState(TypedDict):
        tool_name: str
        argument: str

    def call_model(_: SmokeState) -> dict:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Call lookup_evidence with query score-boundary."}],
            tools=[{
                "type": "function",
                "function": {
                    "name": "lookup_evidence",
                    "description": "Look up isolated prototype evidence.",
                    "parameters": {
                        "type": "object",
                        "properties": {"query": {"type": "string"}},
                        "required": ["query"],
                        "additionalProperties": False,
                    },
                },
            }],
            tool_choice={"type": "function", "function": {"name": "lookup_evidence"}},
        )
        call = response.choices[0].message.tool_calls[0]
        return {"tool_name": call.function.name, "argument": json.loads(call.function.arguments)["query"]}

    builder = StateGraph(SmokeState)
    builder.add_node("model", call_model)
    builder.add_edge(START, "model")
    builder.add_edge("model", END)
    with SqliteSaver.from_conn_string(str(directory / "model-checkpoints.db")) as saver:
        output = builder.compile(checkpointer=saver).invoke(
            {"tool_name": "", "argument": ""},
            {"configurable": {"thread_id": "real-model-tool-smoke"}},
        )
    if output != {"tool_name": "lookup_evidence", "argument": "score-boundary"}:
        raise AssertionError(output)
    return {"status": "passed", "model": model, **output}


def invoke_cli(*args: str, expected: int = 0) -> dict:
    result = subprocess.run([sys.executable, __file__, *args], text=True, capture_output=True)
    if result.returncode != expected:
        raise AssertionError({"args": args, "returncode": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
    return json.loads(result.stdout) if result.stdout else {}


def self_test() -> dict:
    """Exercise the OII-323/OII-330 acceptance boundaries without model or network calls."""
    with tempfile.TemporaryDirectory(prefix="oii-325-") as temp:
        root = Path(temp)

        normal = invoke_cli("start", str(root), "job-normal", "score", "v1", "--corrections", "1")
        assert normal["status"] == "completed" and normal["result"]["outcome"] == "score"
        reused = invoke_cli("start", str(root), "job-normal", "score", "v1")
        assert reused == {"task_id": normal["task_id"], "status": "completed", "reused": True}

        excluded = invoke_cli("start", str(root), "job-excluded", "score", "v1", "--scenario", "exclude")
        assert excluded["result"]["outcome"] == "exclude"
        exhausted = invoke_cli("start", str(root), "job-review", "score", "v1", "--corrections", "3")
        assert exhausted["reason"] == "review_budget_exhausted"

        duplicate = BusinessStore(root / "business.db")
        first = duplicate.start("job-duplicate", "apply", "v1")
        second = duplicate.start("job-duplicate", "score", "v1")
        assert second["task_id"] == first["task_id"]
        duplicate.close()

        failed = invoke_cli("start", str(root), "job-failed", "score", "v1", "--scenario", "raise", expected=1)
        assert failed == {}
        isolated = invoke_cli("start", str(root), "job-isolated", "score", "v1")
        assert isolated["status"] == "completed"

        paused = invoke_cli("start", str(root), "job-apply", "apply", "materials-v1")
        assert paused["reason"] == "human_confirmation"
        old_confirmation = {**paused["interrupt"], "action": "confirm"}
        changed = invoke_cli(
            "resume", str(root), paused["task_id"], "--input", "materials-v2", "--confirmation", json.dumps(old_confirmation)
        )
        assert changed["reason"] == "human_confirmation" and changed["interrupt"]["input_hash"] != old_confirmation["input_hash"]
        current_confirmation = {**changed["interrupt"], "action": "confirm"}
        confirmed = invoke_cli("resume", str(root), paused["task_id"], "--confirmation", json.dumps(current_confirmation))
        assert confirmed["status"] == "completed"

        recovery_store = BusinessStore(root / "business.db")
        recovery = recovery_store.start("job-recovery", "score", "v1")
        recovery_task = recovery_store.task(recovery["task_id"])
        recovery_store.close()
        process = subprocess.run(
            [sys.executable, __file__, "run", str(root), recovery["task_id"], "--state", json.dumps(initial_state(recovery_task, 0, "normal")), "--crash-at", "review"]
        )
        assert process.returncode == 86
        recovered = invoke_cli("run", str(root), recovery["task_id"], "--crash-at", "review")
        assert recovered["status"] == "completed"

        window_store = BusinessStore(root / "business.db")
        window = window_store.start("job-publish-window", "score", "v1")
        window_task = window_store.task(window["task_id"])
        window_store.close()
        process = subprocess.run(
            [sys.executable, __file__, "run", str(root), window["task_id"], "--state", json.dumps(initial_state(window_task, 0, "normal")), "--crash-at", "publish"]
        )
        assert process.returncode == 86
        reconciled = invoke_cli("run", str(root), window["task_id"], "--crash-at", "publish")
        assert reconciled["reconciled"] is True
        verify = BusinessStore(root / "business.db")
        assert verify.db.execute("SELECT COUNT(*) FROM results WHERE task_id=?", (window["task_id"],)).fetchone()[0] == 1
        assert verify.db.execute("SELECT COUNT(*) FROM events WHERE task_id=? AND type='published'", (window["task_id"],)).fetchone()[0] == 1
        verify.close()

        return {
            "status": "passed",
            "checks": [
                "explicit score/exclude branches",
                "valid result reuse",
                "two-round independent review cap",
                "same-opportunity duplicate suppression",
                "cross-opportunity failure isolation",
                "cross-process apply pause/resume",
                "changed-material confirmation invalidation",
                "process-crash checkpoint recovery",
                "business-commit/checkpoint reconciliation",
            ],
        }


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser()
    commands = cli.add_subparsers(dest="command", required=True)
    start = commands.add_parser("start")
    start.add_argument("directory", type=Path)
    start.add_argument("opportunity")
    start.add_argument("module", choices=("score", "apply"))
    start.add_argument("input")
    start.add_argument("--corrections", type=int, default=0)
    start.add_argument("--scenario", choices=("normal", "exclude", "raise"), default="normal")
    start.add_argument("--crash-at", choices=("review", "publish"))
    run = commands.add_parser("run")
    run.add_argument("directory", type=Path)
    run.add_argument("task_id")
    run.add_argument("--state")
    run.add_argument("--crash-at", choices=("review", "publish"))
    resume = commands.add_parser("resume")
    resume.add_argument("directory", type=Path)
    resume.add_argument("task_id")
    resume.add_argument("--input")
    resume.add_argument("--confirmation")
    resume.add_argument("--crash-at", choices=("review", "publish"))
    smoke = commands.add_parser("model-smoke")
    smoke.add_argument("directory", type=Path)
    commands.add_parser("self-test")
    return cli


def main() -> None:
    args = parser().parse_args()
    try:
        if args.command == "start":
            args.directory.mkdir(parents=True, exist_ok=True)
            result = start_and_run(args.directory, args.opportunity, args.module, args.input, args.corrections, args.scenario, args.crash_at)
        elif args.command == "run":
            result = run_task(args.directory, args.task_id, start_state=json.loads(args.state) if args.state else None, crash_at=args.crash_at)
        elif args.command == "resume":
            result = resume_task(args.directory, args.task_id, args.input, json.loads(args.confirmation) if args.confirmation else None, args.crash_at)
        elif args.command == "model-smoke":
            args.directory.mkdir(parents=True, exist_ok=True)
            result = model_smoke(args.directory)
        else:
            result = self_test()
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
