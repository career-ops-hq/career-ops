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
              package_result_key TEXT,
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
        event_columns = {row[1] for row in self.db.execute("PRAGMA table_info(application_events)")}
        if "package_result_key" not in event_columns:
            self.db.execute("ALTER TABLE application_events ADD COLUMN package_result_key TEXT")

    def close(self) -> None:
        self.db.close()

    def status(self, opportunity_id: str) -> str | None:
        row = self.db.execute(
            "SELECT status FROM application_lifecycle WHERE opportunity_id=?", (opportunity_id,)
        ).fetchone()
        return row["status"] if row else None

    def replay(self, state: ApplicationState) -> dict | None:
        key = state["idempotency_key"]
        event = self.db.execute(
            "SELECT opportunity_id,to_status,source,payload FROM application_events WHERE operation_id=?", (key,)
        ).fetchone()
        activity = self.db.execute(
            "SELECT opportunity_id,type,payload FROM application_activity WHERE operation_id=?", (key,)
        ).fetchone()
        if not event and not activity:
            return None
        payload = state["payload"]
        if state["action"] == "outcome":
            payload = {**payload, "outcome": state["value"]}
        if event:
            target = "applied" if state["action"] == "submit" else OUTCOMES.get(state["value"], state["value"])
            same = (
                state["action"] != "activity"
                and str(event["opportunity_id"]) == state["opportunity_id"]
                and event["to_status"] == target
                and event["source"] == state["source"]
                and json.loads(event["payload"]) == payload
            )
            result = {"status": event["to_status"], "reused": True}
        else:
            same = (
                state["action"] == "activity"
                and str(activity["opportunity_id"]) == state["opportunity_id"]
                and activity["type"] == state["value"]
                and json.loads(activity["payload"]) == payload
            )
            result = {"recorded": activity["type"], "reused": True}
        if not same:
            raise ValueError("Idempotency key conflicts with a different application operation")
        return result

    def validate(self, state: ApplicationState) -> None:
        action, value = state["action"], state["value"]
        if self.replay(state):
            return
        if not state["source"].strip():
            raise ValueError("Application source is required")
        if action == "submit":
            if self.status(state["opportunity_id"]):
                raise ValueError("Application was already submitted")
            if not self.db.execute("SELECT 1 FROM opportunities WHERE id=?", (state["opportunity_id"],)).fetchone():
                raise ValueError(f"Unknown opportunity: {state['opportunity_id']}")
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
            if action == "transition" and current == target:
                raise ValueError(f"Invalid application transition: {current} → {target}")
            if current != target and (not current or target not in TRANSITIONS.get(current, set())):
                raise ValueError(f"Invalid application transition: {current or 'none'} → {target}")
        elif action == "activity":
            if value not in ACTIVITIES:
                raise ValueError(f"Invalid application activity: {value}")
            if not self.status(state["opportunity_id"]):
                raise ValueError(f"Opportunity {state['opportunity_id']} has no submitted application")

    def commit(self, state: ApplicationState) -> dict:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            replay = self.replay(state)
            if replay:
                self.db.execute("COMMIT")
                return replay
            self.validate(state)
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
                    self.db.execute(
                        "UPDATE opportunities SET application_state='submitted' WHERE id=?", (opportunity_id,)
                    )
                payload = {**state["payload"], **({"outcome": state["value"]} if state["action"] == "outcome" else {})}
                package_result_key = None
                if state["action"] == "submit":
                    package_result_key = self.db.execute(
                        """SELECT result_key FROM results WHERE opportunity_id=? AND module='apply'
                           AND json_extract(payload,'$.outcome')='package_confirmed' ORDER BY rowid DESC LIMIT 1""",
                        (opportunity_id,),
                    ).fetchone()["result_key"]
                self.db.execute(
                    """INSERT INTO application_events
                       (operation_id,opportunity_id,from_status,to_status,source,payload,package_result_key)
                       VALUES(?,?,?,?,?,?,?)""",
                    (state["idempotency_key"], opportunity_id, current, target, state["source"],
                     json.dumps(payload, ensure_ascii=False, sort_keys=True), package_result_key),
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
            """SELECT from_status AS fromStatus,to_status AS toStatus,source,payload,
                      package_result_key AS packageResultKey,created_at AS createdAt
               FROM application_events WHERE opportunity_id=? ORDER BY id""",
            (opportunity_id,),
        ).fetchall()
        activities = self.db.execute(
            "SELECT type,payload,created_at AS createdAt FROM application_activity WHERE opportunity_id=? ORDER BY id",
            (opportunity_id,),
        ).fetchall()
        decode = lambda row: {**dict(row), "payload": json.loads(row["payload"])}
        opportunity = self.db.execute(
            "SELECT id,url,company,role,source,state,application_state AS applicationState FROM opportunities WHERE id=?",
            (opportunity_id,),
        ).fetchone()
        artifacts = self.db.execute(
            "SELECT kind,path,sha256 FROM artifacts WHERE opportunity_id=? ORDER BY id", (opportunity_id,)
        ).fetchall()
        confirmed = self.db.execute(
            """SELECT r.payload FROM application_events e JOIN results r ON r.result_key=e.package_result_key
               WHERE e.opportunity_id=? AND e.to_status='applied' ORDER BY e.id LIMIT 1""",
            (opportunity_id,),
        ).fetchone()
        package = json.loads(confirmed["payload"]).get("artifact", {}) if confirmed else {}
        return {
            "status": status,
            "opportunity": dict(opportunity) if opportunity else None,
            "events": [decode(row) for row in events],
            "activities": [decode(row) for row in activities],
            "artifacts": [dict(row) for row in artifacts],
            "confirmedPackage": {
                "version": package.get("version"),
                "packageHash": package.get("package_hash"),
                "files": package.get("files", {}),
                "fileHashes": package.get("file_hashes", {}),
            } if confirmed else None,
        }

    def views(self) -> list[dict]:
        return [dict(row) for row in self.db.execute(
            """SELECT o.id AS opportunityId,o.company,o.role,l.status,l.updated_at AS updatedAt
               FROM application_lifecycle l JOIN opportunities o ON o.id=l.opportunity_id
               ORDER BY l.updated_at DESC,o.id DESC"""
        )]

    def followups(self) -> list[dict]:
        return [dict(row) for row in self.db.execute(
            """
            SELECT o.id AS opportunityId,o.company,o.role,l.status,l.updated_at AS lastTransitionAt,
                   MAX(CASE WHEN a.type='followup_sent' THEN a.created_at END) AS lastFollowupAt
            FROM application_lifecycle l JOIN opportunities o ON o.id=l.opportunity_id
            LEFT JOIN application_activity a ON a.opportunity_id=l.opportunity_id
            WHERE l.status IN ('applied','responded','interview')
            GROUP BY o.id,o.company,o.role,l.status,l.updated_at ORDER BY l.updated_at,o.id
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
    if not isinstance(payload, (dict, type(None))):
        raise ValueError("Application payload must be an object")
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
