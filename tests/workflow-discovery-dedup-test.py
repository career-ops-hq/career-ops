"""Pin scanner URL, role and retained SQLite dedup semantics."""

from datetime import date
import json
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.discovery_dedup import (company_aliases, company_role_key, database_snapshot, role_key,
                                      should_dedup, url_key)
from workflow.discovery_store import DiscoveryStore

assert url_key("https://EXAMPLE.com/Jobs/1/?utm_source=x&gh_jid=42#details") == "https://example.com/jobs/1?gh_jid=42"
assert url_key("https://app.mokahr.com/m/candidate/apply/tenant#/job/123") == "https://app.mokahr.com/m/candidate/apply/tenant?mokahr_job_id=123"
assert url_key("not a url") == "not a url"
assert role_key("Engineer (Berlin)") == role_key("Engineer [Remote]") == "engineer"
assert role_key("Engineer (Platform)") == "engineer platform"
assert role_key("バックエンドエンジニア") != role_key("フロントエンドエンジニア")
aliases = company_aliases({"Fin": ["Intercom"], "Other": ["Shared"], "Third": ["Shared"]})
assert company_role_key("Intercom", "Engineer (Berlin)", aliases) == "fin::engineer"
assert company_role_key("Shared", "Engineer", aliases) == "shared::engineer"
today = date(2026, 9, 28)
assert should_dedup("2026-09-01", "added", today=today, recheck_after_days=30)
assert not should_dedup("2026-08-01", "added", today=today, recheck_after_days=30)
assert should_dedup("2026-01-01", "skipped_invalid_url", today=today, recheck_after_days=30)
assert should_dedup("2026-09-01", "cooldown:Acme:2026-09-29", today=today, recheck_after_days=None)
assert not should_dedup("2026-09-01", "cooldown:Acme:2026-09-27", today=today, recheck_after_days=None)

with tempfile.TemporaryDirectory() as temporary:
    store = DiscoveryStore(Path(temporary) / "opportunities.db")
    first = {"url": "https://example.com/a?utm_source=x", "company": "Acme", "title": "Engineer (Berlin)"}
    store.ingest(first, "fixture-api", observed_on="2026-09-28")
    store.scan_outcome({"url": "https://example.com/expired"}, "skipped_expired")
    snapshot = database_snapshot(store.db, today=today)
    assert url_key(first["url"]) in snapshot["seen"]
    assert "acme::engineer" in snapshot["seen_company_roles"]
    assert url_key("https://example.com/expired") in snapshot["seen"]
    assert snapshot["fingerprint_history"] == []
    store.close()

with tempfile.TemporaryDirectory() as temporary:
    database = Path(temporary) / "opportunities.db"
    store = DiscoveryStore(database)
    for url, company, title, state, created in (
        ("old-added", "Acme", "Engineer (Berlin)", "discovered", "2026-08-01 00:00:00"),
        ("new-added", "Beta", "Engineer", "discovered", "2026-09-25 00:00:00"),
        ("old-processed", "Gamma", "Designer", "evaluated", "2026-01-01 00:00:00"),
    ):
        address = f"https://example.com/{url}"
        store.ingest({"url": address, "company": company, "title": title}, "fixture-api")
        store.db.execute("UPDATE opportunities SET state=?,created_at=? WHERE url=?", (state, created, address))
    for url, status in (
        ("dead", "skipped_expired"), ("blocked", "skipped_blocked_host"),
        ("cool-active", "cooldown:Acme:2026-10-01"), ("cool-expired", "cooldown:Acme:2026-09-20"),
    ):
        store.scan_outcome({"url": f"https://example.com/{url}"}, status)
    store.db.commit()
    store.close()
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        python = database_snapshot(connection, today=today, recheck_after_days=7)
    assert python["seen"] == {
        "https://example.com/new-added", "https://example.com/old-processed",
        "https://example.com/dead", "https://example.com/blocked", "https://example.com/cool-active",
    }
    assert python["seen_company_roles"] == {"beta::engineer", "gamma::designer"}
    assert python["fingerprint_history"] == []
    assert len(python["seen"]) == 5 and len(python["seen_company_roles"]) == 2
    assert python["recheck_eligible"] == 2
