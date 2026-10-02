"""Check retained repost rules against independent observed-history examples."""

import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from career_ops.insights.reposts import detect_reposts, repost_view, title_key


def row(url, company, title, day):
    return {"url": url, "company": company, "title": title, "observed_on": day}


assert title_key("Ingénieur Données") == title_key("Ingenieur Donnees")
assert title_key("Engineer - US") != title_key("Engineer - UK")

rows = [
    row("https://jobs.example/a", "Acme Inc.", "Backend Engineer - Paris", "2026-01-01"),
    row("https://jobs.example/b", "Acme", "Engineer Backend Paris", "2026-01-01"),
    row("https://jobs.example/c", "Acme", "Engineer Backend Paris", "2026-02-01"),
    row("https://jobs.example/d", "Acme", "Backend Engineer - Berlin", "2026-02-01"),
    row("https://jobs.example/c", "Acme", "Engineer Backend Paris", "2026-02-02"),
]
clusters = detect_reposts(rows)
assert len(clusters) == 1
assert clusters[0]["repostCount"] == 3 and clusters[0]["daysSpan"] == 31
assert [item["url"] for item in clusters[0]["appearances"]] == [
    "https://jobs.example/a", "https://jobs.example/b", "https://jobs.example/c"
]
assert detect_reposts(rows[:2]) == []
assert detect_reposts(rows, aggregators={"acme"}) == []
assert detect_reposts([row("a", "Acme", "Engineer", "2026-01-01"), row("a", "Acme", "Engineer", "2026-02-01")]) == []
assert detect_reposts([row("a", "Acme", "Engineer", "invalid"), row("b", "Acme", "Engineer", "2026-02-01")]) == []
assert detect_reposts([row("a", "Acme", "Engineer", "20260101"), row("b", "Acme", "Engineer", "2026-02-01")]) == []
assert detect_reposts([row("a", "Acme", "Engineer", "2026-W01-1"), row("b", "Acme", "Engineer", "2026-02-01")]) == []

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    db = sqlite3.connect(root / "isolated.db")
    db.row_factory = sqlite3.Row
    assert repost_view(db, root / "missing.yml")["status"] == "source_missing"
    db.execute("CREATE TABLE scan_observations(id INTEGER PRIMARY KEY,url TEXT,company TEXT,title TEXT,observed_on TEXT)")
    db.executemany("INSERT INTO scan_observations(url,company,title,observed_on) VALUES(:url,:company,:title,:observed_on)", rows)
    db.commit()
    observed = repost_view(db, root / "missing.yml")
    assert observed["observations"] == 5 and len(observed["clusters"]) == 1
    portals = root / "portals.yml"
    portals.write_text("job_boards:\n  - name: Acme\n    aggregator: true\n")
    assert repost_view(db, portals)["clusters"] == []
    db.close()
