"""Persist confirmed application lifecycle changes through a small LangGraph."""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import date
from pathlib import Path
from typing import Literal, TypedDict


try:
    from workflow.followup_cadence import DEFAULT_CADENCE, applied_date_from_notes, cadence, cadence_config, calendar_day
except ModuleNotFoundError:
    from followup_cadence import DEFAULT_CADENCE, applied_date_from_notes, cadence, cadence_config, calendar_day


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
    action: Literal["submit", "transition", "activity", "outcome", "schedule", "retire", "reopen"]
    value: str
    source: str
    payload: dict
    idempotency_key: str


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
              action TEXT NOT NULL,
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
              source TEXT,
              payload TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS application_followup_directives (
              id INTEGER PRIMARY KEY,
              operation_id TEXT NOT NULL UNIQUE,
              opportunity_id TEXT NOT NULL,
              kind TEXT NOT NULL CHECK(kind IN ('schedule','retire','reopen')),
              next_date TEXT,
              set_on TEXT NOT NULL,
              source TEXT NOT NULL,
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
        if "action" not in event_columns:
            self.db.execute("ALTER TABLE application_events ADD COLUMN action TEXT")
        activity_columns = {row[1] for row in self.db.execute("PRAGMA table_info(application_activity)")}
        if "source" not in activity_columns:
            self.db.execute("ALTER TABLE application_activity ADD COLUMN source TEXT")

    def close(self) -> None:
        self.db.close()

    def status(self, opportunity_id: str) -> str | None:
        row = self.db.execute(
            "SELECT status FROM application_lifecycle WHERE opportunity_id=?", (opportunity_id,)
        ).fetchone()
        return row["status"] if row else None

    def submitted_package_key(self, state: ApplicationState) -> str | None:
        """Validate an explicitly identified submitted package, if supplied."""
        requested = state["payload"].get("package_result_key")
        if requested is None:
            return None
        if not isinstance(requested, str) or not self.db.execute(
            """SELECT 1 FROM results WHERE result_key=? AND opportunity_id=? AND module='apply'
               AND json_extract(payload,'$.outcome')='package_confirmed'""",
            (requested, state["opportunity_id"]),
        ).fetchone():
            raise ValueError("package_result_key must identify a confirmed package for this opportunity")
        return requested

    def replay(self, state: ApplicationState) -> dict | None:
        key = state["idempotency_key"]
        event = self.db.execute(
            "SELECT opportunity_id,from_status,to_status,action,source,payload FROM application_events WHERE operation_id=?", (key,)
        ).fetchone()
        activity = self.db.execute(
            "SELECT opportunity_id,type,source,payload FROM application_activity WHERE operation_id=?", (key,)
        ).fetchone()
        directive = self.db.execute(
            """SELECT opportunity_id,kind,next_date,source,payload
               FROM application_followup_directives WHERE operation_id=?""", (key,)
        ).fetchone()
        if not event and not activity and not directive:
            return None
        payload = state["payload"]
        if state["action"] == "outcome":
            payload = {**payload, "outcome": state["value"]}
        if event:
            target = "applied" if state["action"] == "submit" else OUTCOMES.get(state["value"], state["value"])
            event_payload = json.loads(event["payload"])
            event_action = event["action"] or (
                "submit" if event["from_status"] is None else
                "outcome" if "outcome" in event_payload else "transition"
            )
            same = (
                state["action"] == event_action
                and str(event["opportunity_id"]) == state["opportunity_id"]
                and event["to_status"] == target
                and event["source"] == state["source"]
                and event_payload == payload
            )
            result = {"status": event["to_status"], "reused": True}
        elif activity:
            same = (
                state["action"] == "activity"
                and str(activity["opportunity_id"]) == state["opportunity_id"]
                and activity["type"] == state["value"]
                and (activity["source"] is None or activity["source"] == state["source"])
                and json.loads(activity["payload"]) == payload
            )
            result = {"recorded": activity["type"], "reused": True}
        else:
            same = (
                directive["kind"] == state["action"]
                and str(directive["opportunity_id"]) == state["opportunity_id"]
                and directive["next_date"] == (state["value"] if state["action"] == "schedule" else None)
                and directive["source"] == state["source"]
                and json.loads(directive["payload"]) == state["payload"]
            )
            result = {
                "scheduled": directive["next_date"] if state["action"] == "schedule" else None,
                "retired": state["action"] == "retire",
                "reused": True,
            }
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
            submitted_at = state["payload"].get("submitted_at")
            if submitted_at is not None and calendar_day(submitted_at) is None:
                raise ValueError("submitted_at must be a real YYYY-MM-DD date")
            if submitted_at is not None and calendar_day(submitted_at) > date.today():
                raise ValueError("submitted_at cannot be in the future")
            if self.status(state["opportunity_id"]):
                raise ValueError("Application was already submitted")
            if not self.db.execute("SELECT 1 FROM opportunities WHERE id=?", (state["opportunity_id"],)).fetchone():
                raise ValueError(f"Unknown opportunity: {state['opportunity_id']}")
            self.submitted_package_key(state)
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
            sent_at = state["payload"].get("sent_at") if value == "followup_sent" else None
            if sent_at is not None and calendar_day(sent_at) is None:
                raise ValueError("sent_at must be a real YYYY-MM-DD date")
            if sent_at is not None and calendar_day(sent_at) > date.today():
                raise ValueError("sent_at cannot be in the future")
        elif action in {"schedule", "retire", "reopen"}:
            if not self.status(state["opportunity_id"]):
                raise ValueError(f"Opportunity {state['opportunity_id']} has no submitted application")
            if action == "schedule" and calendar_day(value) is None:
                raise ValueError("Next follow-up date must be a real YYYY-MM-DD date")
            if action in {"retire", "reopen"} and value:
                raise ValueError(f"Application {action} does not take a value; use --payload for a reason")

    def commit(self, state: ApplicationState) -> dict:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            replay = self.replay(state)
            if replay:
                self.db.execute("COMMIT")
                return replay
            self.validate(state)
            opportunity_id = state["opportunity_id"]
            if state["action"] in {"schedule", "retire", "reopen"}:
                self.db.execute(
                    """INSERT INTO application_followup_directives
                       (operation_id,opportunity_id,kind,next_date,set_on,source,payload)
                       VALUES(?,?,?,?,?,?,?)""",
                    (state["idempotency_key"], opportunity_id, state["action"],
                     state["value"] if state["action"] == "schedule" else None,
                     date.today().isoformat(), state["source"],
                     json.dumps(state["payload"], ensure_ascii=False, sort_keys=True)),
                )
                result = {
                    "scheduled": state["value"] if state["action"] == "schedule" else None,
                    "retired": state["action"] == "retire",
                    "reused": False,
                }
            elif state["action"] == "activity":
                self.db.execute(
                    "INSERT INTO application_activity(operation_id,opportunity_id,type,source,payload) VALUES(?,?,?,?,?)",
                    (state["idempotency_key"], opportunity_id, state["value"], state["source"],
                     json.dumps(state["payload"], ensure_ascii=False, sort_keys=True)),
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
                    package_result_key = self.submitted_package_key(state)
                self.db.execute(
                    """INSERT INTO application_events
                       (operation_id,opportunity_id,from_status,to_status,action,source,payload,package_result_key)
                       VALUES(?,?,?,?,?,?,?,?)""",
                    (state["idempotency_key"], opportunity_id, current, target, state["action"], state["source"],
                     json.dumps(payload, ensure_ascii=False, sort_keys=True), package_result_key),
                )
                if state["action"] == "outcome":
                    self.db.execute(
                        "INSERT INTO application_activity(operation_id,opportunity_id,type,source,payload) VALUES(?,?,?,?,?)",
                        (state["idempotency_key"], opportunity_id, "outcome_recorded", state["source"],
                         json.dumps(payload, ensure_ascii=False, sort_keys=True)),
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
            "SELECT type,source,payload,created_at AS createdAt FROM application_activity WHERE opportunity_id=? ORDER BY id",
            (opportunity_id,),
        ).fetchall()
        directives = self.db.execute(
            """SELECT kind,next_date AS nextDate,set_on AS setOn,source,payload,created_at AS createdAt
               FROM application_followup_directives WHERE opportunity_id=? ORDER BY id""",
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
            "followupDirectives": [decode(row) for row in directives],
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

    def followups(self, *, today: date | None = None, overdue_only: bool = False, applied_days: int | None = None) -> dict:
        input_root = Path(os.environ.get("CAREER_OPS_INPUT_ROOT", Path(__file__).resolve().parents[1]))
        config = cadence_config(input_root / "config/profile.yml", applied_days=applied_days)
        today = today or date.today()
        rows = self.db.execute(
            """SELECT o.id AS opportunityId,o.url,o.company,o.role,o.created_at AS opportunityCreatedAt,
                      ev.created_at AS evaluatedAt,
                      l.status,l.updated_at AS lastTransitionAt,
                      e.payload AS submissionPayload,e.created_at AS submissionRecordedAt
               FROM application_lifecycle l JOIN opportunities o ON o.id=l.opportunity_id
               LEFT JOIN evaluations ev ON ev.opportunity_id=o.id
               JOIN application_events e ON e.id=(
                   SELECT id FROM application_events WHERE opportunity_id=l.opportunity_id
                   AND to_status='applied' ORDER BY id LIMIT 1)
               WHERE l.status IN ('applied','responded','interview')"""
        ).fetchall()
        entries = []
        for row in rows:
            submission = json.loads(row["submissionPayload"])
            explicit = calendar_day(submission.get("submitted_at"))
            noted = applied_date_from_notes(submission.get("notes"))
            evaluated = calendar_day(row["evaluatedAt"][:10]) if row["evaluatedAt"] else None
            proxy = calendar_day(row["opportunityCreatedAt"][:10]) if row["opportunityCreatedAt"] else None
            recorded = calendar_day(row["submissionRecordedAt"][:10])
            applied = explicit or noted or evaluated or proxy or recorded
            if applied is None:
                continue
            source = (
                "submitted_at" if explicit else "notes" if noted else "evaluation-date-proxy" if evaluated
                else "opportunity-date-proxy" if proxy else "recorded-at-proxy"
            )
            sent = self.db.execute(
                """SELECT payload,created_at FROM application_activity
                   WHERE opportunity_id=? AND type='followup_sent' ORDER BY id""",
                (row["opportunityId"],),
            ).fetchall()
            followups = []
            for item in sent:
                payload = json.loads(item["payload"])
                observed = calendar_day(payload.get("sent_at"))
                recorded = calendar_day(item["created_at"][:10])
                day = observed or recorded
                if day:
                    followups.append({
                        "date": day.isoformat(),
                        "dateSource": "sent_at" if observed else "recorded-at-proxy",
                        "channel": payload.get("channel") if isinstance(payload.get("channel"), str) else None,
                        "notes": payload.get("notes") if isinstance(payload.get("notes"), str) else None,
                    })
            followups.sort(key=lambda item: item["date"], reverse=True)
            last = calendar_day(followups[0]["date"]) if followups else None
            last_source = followups[0]["dateSource"] if followups else None
            score_result = self.db.execute(
                """SELECT result_key,payload FROM results WHERE opportunity_id=? AND module='score'
                   ORDER BY rowid DESC LIMIT 1""", (row["opportunityId"],)
            ).fetchone()
            score_artifact = json.loads(score_result["payload"]).get("artifact", {}) if score_result else {}
            via = submission.get("via")
            entry = {
                "opportunityId": row["opportunityId"],
                "url": row["url"],
                "company": row["company"],
                "role": row["role"],
                "via": via.strip() if isinstance(via, str) and via.strip() and via.strip() != "—" else None,
                "notes": submission.get("notes") if isinstance(submission.get("notes"), str) else "",
                "score": score_artifact.get("score"),
                "reportPath": score_artifact.get("path"),
                "reportSha256": score_artifact.get("report_sha256"),
                "scoreResultKey": score_result["result_key"] if score_result else None,
                "scoreSource": "latest-retained-result" if score_result else None,
                "status": row["status"],
                "lastTransitionAt": row["lastTransitionAt"],
                "lastFollowupAt": last.isoformat() if last else None,
                "lastFollowupDateSource": last_source,
                "followups": followups,
                "appliedDate": applied.isoformat(),
                "appDateSource": source,
                **cadence(row["status"], applied, last, len(sent), today=today, config=config),
            }
            directives = self.db.execute(
                """SELECT kind,next_date,set_on FROM application_followup_directives
                   WHERE opportunity_id=? ORDER BY id""", (row["opportunityId"],)
            ).fetchall()
            scheduled = next((item for item in reversed(directives) if item["kind"] == "schedule"), None)
            set_on = calendar_day(scheduled["set_on"]) if scheduled else None
            next_day = calendar_day(scheduled["next_date"]) if scheduled else None
            if scheduled and set_on and next_day and (last is None or last <= set_on):
                entry["nextOverride"] = scheduled["next_date"]
                entry["nextFollowupDate"] = scheduled["next_date"]
                entry["daysUntilNext"] = (next_day - today).days
                entry["urgency"] = "overdue" if next_day <= today else "waiting"
            else:
                entry["nextOverride"] = None
            retirement = next((item for item in reversed(directives) if item["kind"] in {"retire", "reopen"}), None)
            retired_on = calendar_day(retirement["set_on"]) if retirement else None
            if retirement and retired_on and retirement["kind"] == "retire" and (last is None or last <= retired_on):
                entry["urgency"] = "retired"
                entry["nextFollowupDate"] = None
                entry["daysUntilNext"] = None
            entries.append(entry)
        priority = {"urgent": 0, "overdue": 1, "waiting": 2, "cold": 3}
        entries.sort(key=lambda entry: (priority.get(entry["urgency"], 9), entry["opportunityId"]))
        active = [entry for entry in entries if entry["urgency"] != "retired"]
        visible = [entry for entry in active if not overdue_only or entry["urgency"] in {"urgent", "overdue"}]
        return {
            "metadata": {
                "analysisDate": today.isoformat(),
                "totalTracked": self.db.execute("SELECT COUNT(*) FROM application_lifecycle").fetchone()[0],
                "actionable": len(active),
                "retired": len(entries) - len(active),
                **{status: sum(entry["urgency"] == status for entry in entries)
                   for status in ("urgent", "overdue", "waiting", "cold")},
            },
            "entries": visible,
            "cadenceConfig": config,
            "cadenceDefaults": DEFAULT_CADENCE,
        }


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
    }
    store = ApplicationStore(directory / "opportunities.db")
    try:
        response = {"opportunity_id": str(opportunity_id), **store.commit(state)}
        if action == "outcome":
            response["outcome"] = value
            response["preserved_artifacts"] = store.application(str(opportunity_id))["artifacts"]
        return response
    finally:
        store.close()
