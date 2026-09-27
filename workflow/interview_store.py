"""Persist interview sessions, reviewed drafts, feedback and confirmations in business SQLite."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sqlite3
import uuid


KINDS = frozenset({"prepare", "practice", "debrief", "learn"})
REVIEW_CHECKS = frozenset({"source_grounding", "ownership", "session_scope", "recruiting_risk", "completeness"})


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def review_approved(review: dict) -> bool:
    checks = review.get("checks")
    return (
        review.get("verdict") == "approve"
        and isinstance(checks, dict)
        and set(checks) == REVIEW_CHECKS
        and all(isinstance(item, dict) and item.get("status") == "pass" and item.get("finding") for item in checks.values())
        and review.get("unsupported_claims") == []
        and review.get("required_changes") == []
    )


class InterviewStore:
    """Business rows, not LangGraph checkpoints, decide what is published."""

    def __init__(self, path: Path):
        self.db = sqlite3.connect(path, timeout=5, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS interview_tasks (
              task_id TEXT PRIMARY KEY,
              opportunity_id TEXT NOT NULL,
              session_key TEXT NOT NULL,
              kind TEXT NOT NULL CHECK(kind IN ('prepare','practice','debrief','learn')),
              status TEXT NOT NULL CHECK(status IN ('running','waiting','completed','cancelled')),
              input_hash TEXT NOT NULL,
              input_payload TEXT NOT NULL,
              attempt INTEGER NOT NULL DEFAULT 1,
              waiting_reason TEXT,
              model_calls INTEGER NOT NULL DEFAULT 0,
              elapsed_seconds REAL NOT NULL DEFAULT 0,
              UNIQUE(opportunity_id,session_key,kind,input_hash)
            );
            CREATE TABLE IF NOT EXISTS interview_drafts (
              task_id TEXT NOT NULL REFERENCES interview_tasks(task_id),
              version INTEGER NOT NULL,
              input_hash TEXT NOT NULL,
              artifact_hash TEXT NOT NULL,
              artifact TEXT NOT NULL,
              review TEXT NOT NULL,
              approved INTEGER NOT NULL,
              PRIMARY KEY(task_id,version)
            );
            CREATE TABLE IF NOT EXISTS interview_results (
              task_id TEXT PRIMARY KEY REFERENCES interview_tasks(task_id),
              input_hash TEXT NOT NULL,
              artifact_hash TEXT NOT NULL,
              artifact TEXT NOT NULL,
              confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS interview_feedback (
              id INTEGER PRIMARY KEY,
              task_id TEXT NOT NULL REFERENCES interview_tasks(task_id),
              text TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS interview_events (
              id INTEGER PRIMARY KEY,
              task_id TEXT NOT NULL REFERENCES interview_tasks(task_id),
              type TEXT NOT NULL,
              detail TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """)

    def close(self) -> None:
        self.db.close()

    def task(self, task_id: str) -> sqlite3.Row:
        row = self.db.execute("SELECT * FROM interview_tasks WHERE task_id=?", (task_id,)).fetchone()
        if not row:
            raise ValueError(f"Unknown interview task: {task_id}")
        return row

    def start(self, opportunity_id: str, session_key: str, kind: str, input_payload: dict) -> sqlite3.Row:
        if kind not in KINDS or not session_key.strip():
            raise ValueError("Interview kind and session key are required")
        payload = json.dumps(input_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        input_hash = digest(input_payload)
        self.db.execute("BEGIN IMMEDIATE")
        try:
            existing = self.db.execute(
                "SELECT * FROM interview_tasks WHERE opportunity_id=? AND session_key=? AND kind=? AND input_hash=?",
                (str(opportunity_id), session_key, kind, input_hash),
            ).fetchone()
            if existing:
                self.db.execute("COMMIT")
                return existing
            task_id = str(uuid.uuid4())
            self.db.execute(
                "INSERT INTO interview_tasks(task_id,opportunity_id,session_key,kind,status,input_hash,input_payload) "
                "VALUES(?,?,?,?,'running',?,?)",
                (task_id, str(opportunity_id), session_key, kind, input_hash, payload),
            )
            self.db.execute("INSERT INTO interview_events(task_id,type) VALUES(?,'started')", (task_id,))
            self.db.execute("COMMIT")
            return self.task(task_id)
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    def draft(self, task_id: str) -> dict | None:
        row = self.db.execute(
            "SELECT * FROM interview_drafts WHERE task_id=? ORDER BY version DESC LIMIT 1", (task_id,)
        ).fetchone()
        if not row:
            return None
        artifact = json.loads(row["artifact"])
        if digest(artifact) != row["artifact_hash"]:
            raise ValueError("Interview artifact changed since review")
        return {**dict(row), "artifact": artifact,
                "review": json.loads(row["review"]), "approved": bool(row["approved"])}

    def result(self, task_id: str) -> dict | None:
        row = self.db.execute(
            "SELECT artifact,artifact_hash FROM interview_results WHERE task_id=?", (task_id,)
        ).fetchone()
        if not row:
            return None
        artifact = json.loads(row["artifact"])
        if digest(artifact) != row["artifact_hash"]:
            raise ValueError("Interview artifact changed since confirmation")
        return artifact

    def stage(self, task_id: str, input_hash: str, artifact: dict, review: dict) -> dict:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            task = self.task(task_id)
            if task["status"] != "running" or task["input_hash"] != input_hash:
                raise ValueError("Interview input changed before draft commit")
            version = self.db.execute(
                "SELECT COALESCE(MAX(version),0)+1 FROM interview_drafts WHERE task_id=?", (task_id,)
            ).fetchone()[0]
            approved = review_approved(review)
            self.db.execute(
                "INSERT INTO interview_drafts VALUES(?,?,?,?,?,?,?)",
                (task_id, version, input_hash, digest(artifact),
                 json.dumps(artifact, ensure_ascii=False, sort_keys=True),
                 json.dumps(review, ensure_ascii=False, sort_keys=True), int(approved)),
            )
            reason = "user_review" if approved else "review_budget_exhausted"
            self.db.execute(
                "UPDATE interview_tasks SET status='waiting',waiting_reason=? WHERE task_id=?", (reason, task_id)
            )
            self.db.execute(
                "INSERT INTO interview_events(task_id,type,detail) VALUES(?,'draft_staged',?)",
                (task_id, json.dumps({"version": version, "approved": approved})),
            )
            self.db.execute("COMMIT")
            return self.draft(task_id)
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    def feedback(self, task_id: str, text: str) -> sqlite3.Row:
        if not text.strip():
            raise ValueError("Interview feedback cannot be empty")
        self.db.execute("BEGIN IMMEDIATE")
        try:
            task = self.task(task_id)
            if task["status"] != "waiting":
                raise ValueError("Only a waiting interview draft can be revised")
            self.db.execute("INSERT INTO interview_feedback(task_id,text) VALUES(?,?)", (task_id, text.strip()))
            self.db.execute("UPDATE interview_drafts SET approved=0 WHERE task_id=?", (task_id,))
            self.db.execute(
                "UPDATE interview_tasks SET status='running',waiting_reason=NULL,attempt=attempt+1 WHERE task_id=?", (task_id,)
            )
            self.db.execute("INSERT INTO interview_events(task_id,type) VALUES(?,'feedback_added')", (task_id,))
            self.db.execute("COMMIT")
            return self.task(task_id)
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    def feedback_history(self, task_id: str) -> list[str]:
        return [row[0] for row in self.db.execute(
            "SELECT text FROM interview_feedback WHERE task_id=? ORDER BY id", (task_id,)
        )]

    def add_usage(self, task_id: str, seconds: float) -> sqlite3.Row:
        self.db.execute(
            "UPDATE interview_tasks SET model_calls=model_calls+1,elapsed_seconds=elapsed_seconds+? WHERE task_id=?",
            (max(0, seconds), task_id),
        )
        return self.task(task_id)

    def wait(self, task_id: str, reason: str) -> sqlite3.Row:
        self.db.execute(
            "UPDATE interview_tasks SET status='waiting',waiting_reason=? WHERE task_id=? AND status='running'",
            (reason, task_id),
        )
        return self.task(task_id)

    def confirm(self, task_id: str, current_input_hash: str) -> dict:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            task = self.task(task_id)
            result = self.result(task_id)
            if result is not None:
                self.db.execute("COMMIT")
                return result
            draft = self.draft(task_id)
            if task["status"] != "waiting" or not draft or not draft["approved"]:
                raise ValueError("Interview draft is not approved for confirmation")
            if task["input_hash"] != current_input_hash or draft["input_hash"] != current_input_hash:
                raise ValueError("Interview sources changed; regenerate before confirmation")
            if digest(draft["artifact"]) != draft["artifact_hash"]:
                raise ValueError("Interview artifact changed since review")
            if not review_approved(draft["review"]):
                raise ValueError("Independent interview review did not approve")
            self.db.execute(
                "INSERT INTO interview_results(task_id,input_hash,artifact_hash,artifact) VALUES(?,?,?,?)",
                (task_id, current_input_hash, draft["artifact_hash"],
                 json.dumps(draft["artifact"], ensure_ascii=False, sort_keys=True)),
            )
            self.db.execute("UPDATE interview_tasks SET status='completed',waiting_reason=NULL WHERE task_id=?", (task_id,))
            self.db.execute("INSERT INTO interview_events(task_id,type) VALUES(?,'confirmed')", (task_id,))
            self.db.execute("COMMIT")
            return draft["artifact"]
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    def history(self, opportunity_id: str, session_key: str) -> list[dict]:
        rows = self.db.execute(
            "SELECT t.kind,t.task_id,r.artifact,r.artifact_hash,r.confirmed_at FROM interview_results r "
            "JOIN interview_tasks t ON t.task_id=r.task_id WHERE t.opportunity_id=? AND t.session_key=? "
            "ORDER BY r.confirmed_at,t.rowid", (str(opportunity_id), session_key),
        )
        history = []
        for row in rows:
            artifact = json.loads(row["artifact"])
            if digest(artifact) != row["artifact_hash"]:
                raise ValueError("Interview artifact changed since confirmation")
            history.append({"kind": row["kind"], "task_id": row["task_id"],
                            "artifact": artifact, "confirmed_at": row["confirmed_at"]})
        return history
