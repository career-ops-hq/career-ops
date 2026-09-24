"""Check the Node collector bridge and its evidence-bound LangGraph handoff."""

from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.career_ops import current_discovered_scan_source, discovered_scan_source
from workflow.discovery import capture_jd, discover


with tempfile.TemporaryDirectory(prefix="career-ops-provider-bridge-") as temporary:
    directory = Path(temporary)
    database = directory / "opportunities.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE scan_runs (id INTEGER PRIMARY KEY, operation TEXT, summary TEXT)")
        connection.execute("INSERT INTO scan_runs(operation,summary) VALUES('configured',?)", (json.dumps({
            "companies": 2, "boards": 1, "found": 3, "newAdded": 1, "errors": 0, "handoff": 2,
            "handoff_sources": [{"company": "Unresolved", "method": "websearch", "query": "official jobs"}],
        }),))
    config = directory / "portals.yml"
    with patch("workflow.discovery.subprocess.run", return_value=subprocess.CompletedProcess([], 0)) as scanner:
        result = discover(directory, config, company_filter="Example")
    assert result == {
        "status": "partial", "sources": 3, "checked": 3, "added": 1, "errors": 0,
        "handoff": 2, "failures": [],
        "handoff_sources": [{"company": "Unresolved", "method": "websearch", "query": "official jobs"}],
    }
    command = scanner.call_args.args[0]
    assert command[:3] == ["node", str(ROOT / "scan.mjs"), "configured"]
    assert command[-2:] == ["--company", "Example"]
    assert scanner.call_args.kwargs["env"]["CAREER_OPS_OPPORTUNITY_DB"] == str(database)
    with patch("workflow.discovery.subprocess.run", return_value=subprocess.CompletedProcess([], 1, stderr="blocked")):
        assert discover(directory, config)["status"] == "failed"
    with patch("workflow.discovery.subprocess.run", side_effect=subprocess.TimeoutExpired([], 900)):
        assert discover(directory, config)["status"] == "failed"


jd = "Real captured job description with responsibilities and qualifications."
url = "https://jobs.example.org/posting/123"
captured_at = datetime.now(timezone.utc).isoformat()
row = {
    "id": 123, "url": url, "company": "Example", "role": "Engineer",
    "content": "Provider listing preview", "captured_at": captured_at,
    "capture_payload": json.dumps({
        "url": url, "location": "Hong Kong",
        "scan_jd": {
            "text": jd, "retrieved_at": captured_at, "final_url": url,
            "content_hash": hashlib.sha256(jd.encode()).hexdigest(),
        },
    }),
}
source = discovered_scan_source(row)
assert source["jd"] == jd and source["liveness"] == "active"
assert source["capture_method"] == "browser_snapshot"
assert source["location_evidence"] == "Hong Kong"
assert discovered_scan_source({**row, "capture_payload": row["capture_payload"].replace("123", "456")})["liveness"] == "uncertain"
stale = json.loads(row["capture_payload"])
stale["scan_jd"]["retrieved_at"] = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
assert discovered_scan_source({**row, "capture_payload": json.dumps(stale)})["liveness"] == "uncertain"
fresh = {"status": "captured", "url": url, "text": jd + " Updated", "retrieved_at": captured_at}
with patch("workflow.career_ops.capture_jd", return_value=fresh) as browser:
    recovered = current_discovered_scan_source({**row, "capture_payload": json.dumps(stale)}, Path("/tmp/scan"))
assert browser.call_count == 1 and recovered["liveness"] == "active"
assert recovered["jd"] == fresh["text"]
with patch("workflow.career_ops.capture_jd", return_value=None):
    assert current_discovered_scan_source({**row, "capture_payload": json.dumps(stale)}, Path("/tmp/scan"))["liveness"] == "uncertain"
with patch("workflow.discovery.subprocess.run", return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps({"snapshot": fresh}))) as browser:
    assert capture_jd(Path("/tmp/scan"), url) == fresh
assert browser.call_args.args[0][1].endswith("lib/scan-jd.mjs")
with patch("workflow.discovery.subprocess.run", return_value=subprocess.CompletedProcess([], 0, stdout="not-json")):
    assert capture_jd(Path("/tmp/scan"), url) is None

print("workflow discovery: provider bridge and evidence handoff passed")
