"""Check discovery evidence passed to LangGraph and guarded JD capture."""

from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.career_ops import current_discovered_scan_source, discovered_scan_source, same_posting_url
from workflow.discovery import capture_jd


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
with patch("workflow.discovery.subprocess.run", return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps({"snapshot": fresh}))) as browser:
    assert capture_jd(Path("/tmp/scan"), url, fresh=True) == fresh
assert browser.call_args.args[0][-1] == "--fresh"
ibm = "https://careers.ibm.com/careers/JobDetail?jobId=131606"
localized = "https://careers.ibm.com/en_US/careers/JobDetail?jobId=131606"
assert same_posting_url(ibm, localized)
assert not same_posting_url(ibm, localized.replace("131606", "131607"))
ibm_row = {**row, "url": ibm, "capture_payload": json.dumps({
    "url": ibm, "scan_jd": {"text": jd, "retrieved_at": captured_at,
                            "final_url": localized, "content_hash": hashlib.sha256(jd.encode()).hexdigest()},
})}
assert discovered_scan_source(ibm_row)["liveness"] == "active"
with patch("workflow.discovery.subprocess.run", return_value=subprocess.CompletedProcess([], 0, stdout="not-json")):
    assert capture_jd(Path("/tmp/scan"), url) is None

print("workflow discovery: evidence handoff passed")
