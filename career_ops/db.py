"""Own durable task identity, business results and publication transactions."""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from career_ops.evaluation.decisions import classify as classify_decision, order as order_decisions, valid_scores
from career_ops.context import WORKFLOW_VERSION
from career_ops.input_contracts import canonical_scan_input, digest, score_inputs, verify_package_files
from career_ops.task_state import WorkflowState


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
        evaluation = self.db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='evaluations'").fetchone()
        if evaluation and ("dimension_scores" not in evaluation["sql"] or "lower_score REAL NOT NULL" in evaluation["sql"]):
            self.db.executescript("""
                PRAGMA foreign_keys=OFF;
                BEGIN IMMEDIATE;
                CREATE TABLE evaluations_new (
                  opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id),
                  lower_score REAL, upper_score REAL, coverage REAL, dimension_scores TEXT,
                  report_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO evaluations_new(opportunity_id,lower_score,upper_score,coverage,report_hash,created_at)
                  SELECT opportunity_id,lower_score,upper_score,coverage,report_hash,created_at FROM evaluations;
                DROP TABLE evaluations;
                ALTER TABLE evaluations_new RENAME TO evaluations;
                COMMIT;
                PRAGMA foreign_keys=ON;
            """)
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
                or not valid_scores(score)
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
                        "INSERT INTO evaluations(opportunity_id,dimension_scores,report_hash) "
                        "VALUES(?,?,?) ON CONFLICT(opportunity_id) DO UPDATE SET "
                        "lower_score=NULL,upper_score=NULL,coverage=NULL,"
                        "dimension_scores=excluded.dimension_scores,report_hash=excluded.report_hash,created_at=CURRENT_TIMESTAMP",
                        (opportunity_id, json.dumps(artifact["score"], sort_keys=True), artifact["report_sha256"]),
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
            scan = self.module_result(opportunity_id, "scan")
            if scan and scan["outcome"] != "jd_report":
                continue
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
                    report = scan["artifact"] if scan else json.loads(source_task["input_payload"])["jd_report"]
                    current = score_inputs(report)
                    valid = digest(current) == row["input_hash"]
                    reason = None if valid else "candidate_or_policy_inputs_changed"
                except (KeyError, OSError, ValueError):
                    reason = "stored_input_invalid"
            if valid_scores(score) or isinstance(score, dict) and set(score) == {"lower", "upper", "coverage"}:
                values.append({
                    "opportunity_id": opportunity_id, "scores": score if valid_scores(score) else None,
                    "valid": valid and valid_scores(score),
                    "stale_reason": reason if valid_scores(score) else "candidate_or_policy_inputs_changed",
                })
        values.sort(key=lambda item: item["opportunity_id"])
        return values

    def decision_views(self) -> dict:
        """Derive the current action queue only from valid formal score inputs."""
        ready, stale = [], []
        for item in self.score_views():
            if not item["valid"]:
                stale.append(item)
                continue
            scan = self.module_result(item["opportunity_id"], "scan")
            if scan:
                report = scan["artifact"]
            else:
                source = self.db.execute(
                    "SELECT t.input_payload FROM results r JOIN tasks t ON t.task_id=r.task_id "
                    "WHERE r.opportunity_id=? AND r.module='score' ORDER BY r.rowid DESC LIMIT 1",
                    (item["opportunity_id"],),
                ).fetchone()
                report = json.loads(source["input_payload"])["jd_report"]
            ready.append({
                **item, "action": classify_decision(item["scores"], report["prescreen"]),
                "deadline": None, "effort_days": None,
            })
        return {"decisions": order_decisions(ready), "stale": stale}
