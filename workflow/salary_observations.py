"""Record confirmed compensation evidence in one idempotent business transaction."""

from __future__ import annotations

from datetime import date
from pathlib import Path
import sqlite3
from typing import TypedDict



TYPES = {"desired", "advertised", "actual", "stated"}
FIELDS = ("opportunity_id", "date", "type", "amount", "currency", "source", "note", "round", "interviewer")


class SalaryState(TypedDict):
    operation_id: str
    opportunity_id: str
    date: str
    type: str
    amount: str
    currency: str
    source: str
    note: str
    round: str
    interviewer: str


class SalaryStore:
    """Own the append-only compensation trail in the canonical business store."""

    def __init__(self, path: Path):
        self.db = sqlite3.connect(path, timeout=5, isolation_level=None)
        self.db.row_factory = sqlite3.Row

    def close(self) -> None:
        self.db.close()

    def validate(self, state: SalaryState) -> None:
        if any(not isinstance(state[key], str) for key in FIELDS):
            raise ValueError("Salary observation fields must be strings")
        if not state["operation_id"].strip() or state["type"] not in TYPES:
            raise ValueError("Salary observation needs an operation ID and valid type")
        if not all(isinstance(state[key], str) and state[key].strip() for key in
                   ("opportunity_id", "date", "amount", "source")):
            raise ValueError("Salary observation identity, date, amount and source are required")
        try:
            date.fromisoformat(state["date"])
        except ValueError as error:
            raise ValueError("Salary observation date must be YYYY-MM-DD") from error
        if not self.db.execute("SELECT 1 FROM opportunities WHERE id=?", (state["opportunity_id"],)).fetchone():
            raise ValueError("Salary observation opportunity does not exist")

    def commit(self, state: SalaryState) -> dict:
        self.validate(state)
        values = tuple(state[key].strip() for key in FIELDS)
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("""CREATE TABLE IF NOT EXISTS salary_observations (
                id INTEGER PRIMARY KEY,
                operation_id TEXT NOT NULL UNIQUE,
                opportunity_id TEXT NOT NULL,
                date TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('desired','advertised','actual','stated')),
                amount TEXT NOT NULL,
                currency TEXT NOT NULL,
                source TEXT NOT NULL,
                note TEXT NOT NULL,
                round TEXT NOT NULL,
                interviewer TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""")
            prior = self.db.execute("SELECT * FROM salary_observations WHERE operation_id=?", (state["operation_id"],)).fetchone()
            if prior:
                if values != tuple(prior[key] for key in FIELDS):
                    raise ValueError("Salary observation operation ID already used with different evidence")
                result = {"id": prior["id"], "reused": True}
            else:
                cursor = self.db.execute(
                    "INSERT INTO salary_observations(operation_id," + ",".join(FIELDS) + ") VALUES(" + ",".join("?" for _ in range(10)) + ")",
                    (state["operation_id"], *values),
                )
                result = {"id": cursor.lastrowid, "reused": False}
            self.db.execute("COMMIT")
            return result
        except Exception:
            self.db.execute("ROLLBACK")
            raise


def record_salary(directory: Path, observation: dict, operation_id: str) -> dict:
    """Validate and commit; replay only the same operation."""
    if not isinstance(observation, dict) or not isinstance(operation_id, str):
        raise ValueError("Salary observation must be an object with an operation ID")
    if set(observation) - set(FIELDS):
        raise ValueError("Salary observation has unknown fields")
    state: SalaryState = {"operation_id": operation_id, **{key: observation.get(key, "") for key in FIELDS}}
    store = SalaryStore(directory / "opportunities.db")
    try:
        return {"opportunity_id": state["opportunity_id"], **store.commit(state)}

    finally:
        store.close()
