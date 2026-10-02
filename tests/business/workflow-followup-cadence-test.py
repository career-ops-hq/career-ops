"""Check Node follow-up cadence parity against dated canonical application facts."""

import sqlite3
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from career_ops.applications.application_lifecycle import ApplicationStore
from career_ops.applications.followup_cadence import DEFAULT_CADENCE, applied_date_from_notes, cadence, cadence_config


today = date(2026, 9, 27)
applied = date(2026, 9, 20)
assert applied_date_from_notes("Applied 2026-09-20; replied 2026-09-24") == applied
assert applied_date_from_notes("Applied 2026-02-30; applied 2026-09-20") == applied
assert applied_date_from_notes("#154 applied 2026-08-04; applied 2026-09-20") == applied
assert applied_date_from_notes("#154 is live; applied 2026-08-04") is None
assert applied_date_from_notes("Req #1311 - applied 2026-09-20") == applied
assert applied_date_from_notes("#154 was slow. Applied 2026-09-20") == applied
assert applied_date_from_notes("#154 applied 2026-08-04 | applied 2026-09-20") == applied
assert cadence("applied", applied, None, 0, today=today, config=DEFAULT_CADENCE) == {
    "daysSinceApplication": 7,
    "daysSinceLastFollowup": None,
    "followupCount": 0,
    "urgency": "overdue",
    "nextFollowupDate": "2026-09-27",
    "daysUntilNext": 0,
}
assert cadence("applied", applied, date(2026, 9, 24), 2, today=today, config=DEFAULT_CADENCE)["urgency"] == "cold"
assert cadence("applied", applied, date(2026, 9, 24), 2, today=today, config=DEFAULT_CADENCE)["nextFollowupDate"] is None
assert cadence("responded", today, None, 0, today=today, config=DEFAULT_CADENCE)["urgency"] == "urgent"
assert cadence("interview", applied, date(2026, 9, 25), 1, today=today, config=DEFAULT_CADENCE)["nextFollowupDate"] == "2026-09-28"

with tempfile.TemporaryDirectory() as temporary:
    directory = Path(temporary)
    profile = directory / "profile.yml"
    profile.write_text("followup_cadence:\n  applied_first_days: 5\n  applied_max_followups: 1\n", encoding="utf-8")
    assert cadence_config(profile)["applied_first"] == 5
    assert cadence_config(profile, applied_days=3)["applied_first"] == 3
    profile.write_text("followup_cadence:\n  applied_first_days: '6'\n", encoding="utf-8")
    assert cadence_config(profile)["applied_first"] == 6
    profile.write_text("followup_cadence: [\n", encoding="utf-8")
    assert cadence_config(profile) == DEFAULT_CADENCE

    path = directory / "opportunities.db"
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE opportunities(id INTEGER PRIMARY KEY,url TEXT,company TEXT,role TEXT,created_at TEXT);
        CREATE TABLE evaluations(opportunity_id INTEGER PRIMARY KEY,created_at TEXT);
        CREATE TABLE results(result_key TEXT PRIMARY KEY,opportunity_id TEXT,module TEXT,payload TEXT);
        INSERT INTO opportunities VALUES(42,'https://jobs.example.com/42','Realistic Employer','Engineer','2026-09-18 00:00:00');
        INSERT INTO evaluations VALUES(42,'2026-09-19 00:00:00');
        INSERT INTO results VALUES('score-42','42','score','{"artifact":{"score":{"lower":61,"upper":74,"coverage":0.8},"path":"/review/score.md","report_sha256":"report-sha"}}');
        """
    )
    db.close()
    store = ApplicationStore(path)
    store.db.executescript(
        """
        INSERT INTO application_lifecycle(opportunity_id,status,updated_at) VALUES(42,'applied','2026-09-21 00:00:00');
        INSERT INTO application_events(operation_id,opportunity_id,to_status,action,source,payload,created_at)
          VALUES('submit-42',42,'applied','submit','candidate-confirmed','{"submitted_at":"2026-09-20","via":"Agency","notes":"Receipt retained"}','2026-09-21 00:00:00');
        """
    )
    view = store.followups(today=today)
    assert view["metadata"]["overdue"] == 1
    assert view["entries"][0]["url"] == "https://jobs.example.com/42"
    assert view["entries"][0]["via"] == "Agency"
    assert view["entries"][0]["notes"] == "Receipt retained"
    assert view["entries"][0]["score"] == {"lower": 61, "upper": 74, "coverage": 0.8}
    assert view["entries"][0]["scoreResultKey"] == "score-42"
    assert view["entries"][0]["scoreSource"] == "latest-retained-result"
    assert view["entries"][0]["reportPath"] == "/review/score.md"
    assert view["entries"][0]["reportSha256"] == "report-sha"
    assert view["entries"][0]["appDateSource"] == "submitted_at"
    assert view["entries"][0]["nextFollowupDate"] == "2026-09-27"
    store.db.execute(
        "INSERT INTO application_activity(operation_id,opportunity_id,type,payload,created_at) VALUES(?,?,?,?,?)",
        ("followup-42", 42, "followup_sent", '{"sent_at":"2026-09-25","channel":"email","notes":"Sent"}', "2026-09-26 00:00:00"),
    )
    view = store.followups(today=today)
    assert view["entries"][0]["lastFollowupAt"] == "2026-09-25"
    assert view["entries"][0]["lastFollowupDateSource"] == "sent_at"
    assert view["entries"][0]["followups"] == [
        {"date": "2026-09-25", "dateSource": "sent_at", "channel": "email", "notes": "Sent"}
    ]
    assert view["entries"][0]["nextFollowupDate"] == "2026-10-02"
    assert store.followups(today=today, overdue_only=True)["entries"] == []
    store.db.execute(
        """INSERT INTO application_followup_directives
           (operation_id,opportunity_id,kind,next_date,set_on,source,payload)
           VALUES('next-42',42,'schedule','2026-10-05','2026-09-26','candidate-confirmed','{}')"""
    )
    assert store.followups(today=today)["entries"][0]["nextOverride"] == "2026-10-05"
    store.db.execute(
        """INSERT INTO application_followup_directives
           (operation_id,opportunity_id,kind,set_on,source,payload)
           VALUES('retire-42',42,'retire','2026-09-26','candidate-confirmed','{}')"""
    )
    assert store.followups(today=today)["metadata"]["retired"] == 1
    assert store.followups(today=today)["entries"] == []
    store.db.execute(
        "INSERT INTO application_activity(operation_id,opportunity_id,type,payload,created_at) VALUES(?,?,?,?,?)",
        ("followup-43", 42, "followup_sent", '{"sent_at":"2026-09-27"}', "2026-09-27 00:00:00"),
    )
    resumed = store.followups(today=today)["entries"][0]
    assert resumed["urgency"] == "cold"
    assert resumed["nextOverride"] is None
    assert resumed["nextFollowupDate"] is None
    store.db.execute("UPDATE application_events SET payload=? WHERE operation_id='submit-42'", ('{"notes":"#154 applied 2026-08-04; Applied 2026-09-20"}',))
    assert store.followups(today=today)["entries"][0]["appDateSource"] == "notes"
    assert store.followups(today=today)["entries"][0]["appliedDate"] == "2026-09-20"
    store.db.execute("UPDATE application_events SET payload='{}' WHERE operation_id='submit-42'")
    assert store.followups(today=today)["entries"][0]["appDateSource"] == "evaluation-date-proxy"
    assert store.followups(today=today)["entries"][0]["appliedDate"] == "2026-09-19"
    store.db.execute("DELETE FROM evaluations WHERE opportunity_id=42")
    assert store.followups(today=today)["entries"][0]["appDateSource"] == "opportunity-date-proxy"
    store.close()

print("workflow follow-up cadence: dates, urgency, profile and canonical history passed")
