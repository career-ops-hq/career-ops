"""Check confirmed salary recording, idempotency and read-only query recovery."""

import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from workflow.salary_observations import record_salary
from workflow.insights.salary import salary_view, stated_view


with tempfile.TemporaryDirectory() as temp:
    directory = Path(temp)
    with sqlite3.connect(directory / "opportunities.db") as db:
        db.executescript("CREATE TABLE opportunities(id INTEGER PRIMARY KEY,company TEXT,role TEXT); INSERT INTO opportunities VALUES(1,'Acme','Engineer');")
    observation = {"opportunity_id": "1", "date": "2026-01-01", "type": "stated", "amount": "90k",
                   "currency": "EUR", "source": "user", "note": "screen call", "round": "screen",
                   "interviewer": "Recruiter"}
    try:
        record_salary(directory, {**observation, "date": "not-a-date"}, "salary-bad")
    except ValueError:
        pass
    else:
        raise AssertionError("Invalid date was accepted")
    with sqlite3.connect(directory / "opportunities.db") as db:
        assert db.execute("SELECT 1 FROM sqlite_master WHERE name='salary_observations'").fetchone() is None
    first = record_salary(directory, observation, "salary-1")
    assert first["reused"] is False
    second = record_salary(directory, observation, "salary-1")
    assert second == {**first, "reused": True}
    try:
        record_salary(directory, {**observation, "amount": "100k"}, "salary-1")
    except ValueError as error:
        assert "different evidence" in str(error)
    else:
        raise AssertionError("Conflicting idempotency key was accepted")
    profile = directory / "profile.yml"
    profile.write_text("compensation: {}\n")
    with sqlite3.connect(f"file:{directory / 'opportunities.db'}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        view = salary_view(db, profile)
        assert view["result"]["applications"][0]["trail"][0]["interviewer"] == "Recruiter"
        assert view["result"]["applications"][0]["actual"] is None
        assert stated_view(db, "1")["statements"][0]["round"] == "screen"
        assert stated_view(db, "2")["statements"] == []
