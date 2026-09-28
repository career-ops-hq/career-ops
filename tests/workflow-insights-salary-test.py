"""Check compensation parsing, trust precedence, currency guards and evidence quality."""

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from workflow.insights.salary import parse_amount, salary_fold, salary_view


assert parse_amount("80-90k")["mid"] == 85000
assert parse_amount("€35.000 - €45.000")["mid"] == 40000
assert parse_amount("$123,684—$254,644 USD")["mid"] == 189164
assert parse_amount("competitive") is None

def observation(key, date, kind, amount, currency, source):
    return {"opportunity_id": key, "date": date, "type": kind, "amount": amount,
            "currency": currency, "source": source, "note": "", "round": "", "interviewer": ""}


rows = [
    observation("1", "2026-01-01", "desired", "95k", "EUR", "user"),
    observation("1", "2026-01-01", "advertised", "80-90k", "EUR", "jd"),
    observation("1", "2026-02-01", "actual", "100k", "EUR", "recruiter-verbal"),
    observation("1", "2026-02-02", "actual", "86k", "EUR", "contract"),
    observation("1", "2026-02-03", "stated", "95k", "EUR", "user"),
    observation("2", "2026-01-01", "actual", "88k", "GBP", "offer-letter"),
    observation("2", "2026-01-02", "actual", "120k", "GBP", "toString"),
    observation("2", "2026-01-01", "advertised", "90k", "USD", "jd"),
    observation("9", "2026-01-01", "actual", "?", "", "user"),
]
folded = salary_fold(rows, {"1": {"company": "A", "role": "Engineer"},
                            "2": {"company": "B", "role": "Designer"}})
first, second = folded["applications"]
assert first["actual"]["value"] == 86000 and first["actual"]["source"] == "contract"
assert first["advToActPct"] > 1 and first["desiredToActPct"] < 0
assert len(first["trail"]) == 5 and first["trail"][-1]["type"] == "stated"
assert second["advToActPct"] is None and second["actual"]["value"] == 88000
assert folded["quality"]["currencyMismatches"][0]["currencies"] == ["USD", "GBP"]
assert folded["quality"]["invalidSources"][0]["source"] == "toString"
assert folded["quality"]["orphans"][0]["opportunity_id"] == "9"
assert folded["aggregates"]["byCurrency"]["EUR"]["confirmed"] == 1

with tempfile.TemporaryDirectory() as temp:
    profile = Path(temp) / "profile.yml"
    profile.write_text("compensation:\n  target_range: competitive\n  currency: EUR\n")
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    assert salary_view(db, profile)["status"] == "source_missing"
    db.executescript("CREATE TABLE opportunities(id INTEGER PRIMARY KEY,company TEXT,role TEXT); INSERT INTO opportunities VALUES(1,'A','Engineer');")
    view = salary_view(db, profile)
    assert view["sources"]["salary_observations"] is False
    assert view["result"]["quality"]["unparseable"][0]["raw"] == "competitive"
    db.execute("CREATE TABLE results(opportunity_id TEXT,module TEXT,payload TEXT)")
    report = "## Machine Summary\n```yaml\ncaptured_at: 2026-01-01\nadvertised_comp:\n  amount: 300k-400k\n  currency: CNY\n  quote: Annual salary CNY 300k-400k\n```\n"
    db.execute("INSERT INTO results VALUES(?,?,?)", ("1", "score", json.dumps({
        "outcome": "score", "artifact": {"report": report}
    })))
    paid = salary_view(db, profile)
    assert paid["result"]["applications"][0]["advertised"]["value"] == 350000
    assert paid["result"]["applications"][0]["advertised"]["source"] == "jd"
