"""Persist confirmed application lifecycle changes through a small LangGraph."""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Literal, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph


STATUSES = {"applied", "responded", "interview", "offer", "rejected", "discarded", "hired"}
TRANSITIONS = {
    "applied": {"responded", "interview", "offer", "rejected", "discarded"},
    "responded": {"interview", "offer", "rejected", "discarded"},
    "interview": {"offer", "rejected", "discarded"},
    "offer": {"hired", "discarded"},
}
ACTIVITIES = {"followup_sent", "reply_suggested", "outcome_recorded", "offer_prepared"}
OUTCOMES = {
    "interview_progress": "interview",
    "offer_received": "offer",
    "hired": "hired",
    "offer_declined": "discarded",
    "rejected": "rejected",
    "no_response": "discarded",
    "interview_only": "discarded",
}


class ApplicationState(TypedDict):
    operation_id: str
    opportunity_id: str
    action: Literal["submit", "transition", "activity", "outcome"]
    value: str
    source: str
    payload: dict
    idempotency_key: str
    validated: bool
    result: dict


class ApplicationStore:
    """Own application facts and their append-only evidence history."""

    def __init__(self, path: Path):
        self.db = sqlite3.connect(path, timeout=5, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(
            """
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS application_lifecycle (
              opportunity_id TEXT PRIMARY KEY,
              status TEXT NOT NULL CHECK(status IN ('applied','responded','interview','offer','rejected','discarded','hired')),
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS application_events (
              id INTEGER PRIMARY KEY,
              operation_id TEXT NOT NULL UNIQUE,
              opportunity_id TEXT NOT NULL,
              from_status TEXT,
              to_status TEXT NOT NULL,
              source TEXT NOT NULL,
              payload TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS application_activity (
              id INTEGER PRIMARY KEY,
              operation_id TEXT NOT NULL UNIQUE,
              opportunity_id TEXT NOT NULL,
              type TEXT NOT NULL CHECK(type IN ('followup_sent','reply_suggested','outcome_recorded','offer_prepared')),
              payload TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        for table, prefix in (("application_events", "legacy-event"), ("application_activity", "legacy-activity")):
            columns = {row[1] for row in self.db.execute(f"PRAGMA table_info({table})")}
            if "operation_id" not in columns:
                self.db.execute(f"ALTER TABLE {table} ADD COLUMN operation_id TEXT")
                self.db.execute(f"UPDATE {table} SET operation_id=? || '-' || id", (prefix,))
            self.db.execute(
                f"CREATE UNIQUE INDEX IF NOT EXISTS {table}_operation_id ON {table}(operation_id)"
            )

    def close(self) -> None:
        self.db.close()

    def status(self, opportunity_id: str) -> str | None:
        row = self.db.execute(
            "SELECT status FROM application_lifecycle WHERE opportunity_id=?", (opportunity_id,)
        ).fetchone()
        return row["status"] if row else None

    def validate(self, state: ApplicationState) -> None:
        action, value = state["action"], state["value"]
        if not state["source"].strip():
            raise ValueError("Application source is required")
        if action == "submit":
            if self.status(state["opportunity_id"]):
                return
            result = self.db.execute(
                "SELECT 1 FROM results WHERE opportunity_id=? AND module='apply' AND json_extract(payload,'$.outcome')='package_confirmed'",
                (state["opportunity_id"],),
            ).fetchone()
            if not result:
                raise ValueError("Submission requires a confirmed application package")
        elif action in {"transition", "outcome"}:
            target = OUTCOMES.get(value) if action == "outcome" else value
            if target not in STATUSES:
                raise ValueError(f"Invalid application status: {target}")
            current = self.status(state["opportunity_id"])
            if current != target and (not current or target not in TRANSITIONS.get(current, set())):
                raise ValueError(f"Invalid application transition: {current or 'none'} → {target}")
        elif action == "activity":
            if value not in ACTIVITIES:
                raise ValueError(f"Invalid application activity: {value}")
            if not self.status(state["opportunity_id"]):
                raise ValueError(f"Opportunity {state['opportunity_id']} has no submitted application")

    def commit(self, state: ApplicationState) -> dict:
        existing = self.db.execute(
            "SELECT to_status AS status FROM application_events WHERE operation_id=?",
            (state["idempotency_key"],),
        ).fetchone()
        if existing:
            return {"status": existing["status"], "reused": True}
        activity = self.db.execute(
            "SELECT type FROM application_activity WHERE operation_id=?", (state["idempotency_key"],)
        ).fetchone()
        if activity:
            return {"recorded": activity["type"], "reused": True}

        self.db.execute("BEGIN IMMEDIATE")
        try:
            opportunity_id = state["opportunity_id"]
            if state["action"] == "activity":
                self.db.execute(
                    "INSERT INTO application_activity(operation_id,opportunity_id,type,payload) VALUES(?,?,?,?)",
                    (state["idempotency_key"], opportunity_id, state["value"], json.dumps(state["payload"], ensure_ascii=False, sort_keys=True)),
                )
                result = {"recorded": state["value"], "reused": False}
            else:
                target = "applied" if state["action"] == "submit" else OUTCOMES.get(state["value"], state["value"])
                current = self.status(opportunity_id)
                if current == target:
                    self.db.execute("COMMIT")
                    return {"status": target, "reused": True}
                if current:
                    self.db.execute(
                        "UPDATE application_lifecycle SET status=?,updated_at=CURRENT_TIMESTAMP WHERE opportunity_id=?",
                        (target, opportunity_id),
                    )
                else:
                    self.db.execute(
                        "INSERT INTO application_lifecycle(opportunity_id,status) VALUES(?,?)",
                        (opportunity_id, target),
                    )
                payload = {**state["payload"], **({"outcome": state["value"]} if state["action"] == "outcome" else {})}
                self.db.execute(
                    "INSERT INTO application_events(operation_id,opportunity_id,from_status,to_status,source,payload) VALUES(?,?,?,?,?,?)",
                    (state["idempotency_key"], opportunity_id, current, target, state["source"], json.dumps(payload, ensure_ascii=False, sort_keys=True)),
                )
                if state["action"] == "outcome":
                    self.db.execute(
                        "INSERT INTO application_activity(operation_id,opportunity_id,type,payload) VALUES(?,?,?,?)",
                        (state["idempotency_key"] + ":activity", opportunity_id, "outcome_recorded", json.dumps(payload, ensure_ascii=False, sort_keys=True)),
                    )
                result = {"status": target, "reused": False}
            self.db.execute("COMMIT")
            return result
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    def application(self, opportunity_id: str) -> dict | None:
        status = self.status(opportunity_id)
        if not status:
            return None
        events = self.db.execute(
            "SELECT from_status AS fromStatus,to_status AS toStatus,source,payload,created_at AS createdAt FROM application_events WHERE opportunity_id=? ORDER BY id",
            (opportunity_id,),
        ).fetchall()
        activities = self.db.execute(
            "SELECT type,payload,created_at AS createdAt FROM application_activity WHERE opportunity_id=? ORDER BY id",
            (opportunity_id,),
        ).fetchall()
        decode = lambda row: {**dict(row), "payload": json.loads(row["payload"])}
        return {"status": status, "events": [decode(row) for row in events], "activities": [decode(row) for row in activities]}

    def views(self) -> list[dict]:
        return [dict(row) for row in self.db.execute(
            "SELECT opportunity_id AS opportunityId,status,updated_at AS updatedAt FROM application_lifecycle ORDER BY updated_at DESC,opportunity_id DESC"
        )]

    def followups(self) -> list[dict]:
        return [dict(row) for row in self.db.execute(
            """
            SELECT l.opportunity_id AS opportunityId,l.status,l.updated_at AS lastTransitionAt,
                   MAX(CASE WHEN a.type='followup_sent' THEN a.created_at END) AS lastFollowupAt
            FROM application_lifecycle l LEFT JOIN application_activity a ON a.opportunity_id=l.opportunity_id
            WHERE l.status IN ('applied','responded','interview')
            GROUP BY l.opportunity_id,l.status,l.updated_at ORDER BY l.updated_at,l.opportunity_id
            """
        )]


class ApplicationWorkflow:
    """Keep validation and the atomic business write as explicit recoverable nodes."""

    def __init__(self, store: ApplicationStore):
        self.store = store

    def validate(self, state: ApplicationState) -> dict:
        self.store.validate(state)
        return {"validated": True}

    def commit(self, state: ApplicationState) -> dict:
        if not state["validated"]:
            raise ValueError("Application operation was not validated")
        return {"result": self.store.commit(state)}

    def graph(self, saver: SqliteSaver):
        builder = StateGraph(ApplicationState)
        builder.add_node("validate", self.validate)
        builder.add_node("commit", self.commit)
        builder.add_edge(START, "validate")
        builder.add_edge("validate", "commit")
        builder.add_edge("commit", END)
        return builder.compile(checkpointer=saver)


def mutate(
    directory: Path,
    opportunity_id: str,
    action: str,
    value: str = "",
    *,
    source: str,
    payload: dict | None = None,
    idempotency_key: str | None = None,
) -> dict:
    """Run one idempotent application mutation and return its business result."""
    directory.mkdir(parents=True, exist_ok=True)
    operation_id = idempotency_key or str(uuid.uuid4())
    state: ApplicationState = {
        "operation_id": operation_id,
        "opportunity_id": str(opportunity_id),
        "action": action,
        "value": value,
        "source": source,
        "payload": payload or {},
        "idempotency_key": operation_id,
        "validated": False,
        "result": {},
    }
    store = ApplicationStore(directory / "opportunities.db")
    try:
        with SqliteSaver.from_conn_string(str(directory / "workflow-checkpoints.db")) as saver:
            result = ApplicationWorkflow(store).graph(saver).invoke(
                state, {"configurable": {"thread_id": f"application:{operation_id}"}}
            )
        return {"opportunity_id": str(opportunity_id), **result["result"]}
    finally:
        store.close()
