"""Verify Python Workday discovery, filtering, evidence retention and deduplication."""

import json
from pathlib import Path
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.discovery import discover


with tempfile.TemporaryDirectory(prefix="career-ops-discovery-") as temporary:
    root = Path(temporary)
    config = root / "portals.yml"
    config.write_text("""
title_filter:
  positive: [Engineer]
location_filter:
  allow: [China]
  block: [India]
  always_allow: [China]
tracked_companies:
  - name: Example
    provider: workday
    api: https://example.wd1.myworkdayjobs.com/External
    enabled: true
""")
    calls = []

    def fetch(url, payload=None):
        calls.append((url, payload))
        if payload is not None:
            return {"jobPostings": [
                {"title": "AI Engineer", "locationsText": "Shanghai, China", "externalPath": "/job/ai"},
                {"title": "Sales Lead", "locationsText": "Shanghai, China", "externalPath": "/job/sales"},
                {"title": "Cloud Engineer", "locationsText": "India", "externalPath": "/job/cloud"},
            ]}
        return {"jobPostingInfo": {
            "externalUrl": "https://example.wd1.myworkdayjobs.com/External/job/ai",
            "jobDescription": "<p>Build reviewed AI systems.</p>",
        }}

    first = discover(root, config, fetch)
    second = discover(root, config, fetch)
    assert first == {"status": "completed", "sources": 1, "checked": 1, "added": 1, "failures": []}
    assert second["added"] == 0
    assert calls[0][0] == "https://example.wd1.myworkdayjobs.com/wday/cxs/example/External/jobs"
    db = sqlite3.connect(root / "opportunities.db")
    assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 1
    assert db.execute("SELECT content FROM page_evidence").fetchone()[0] == "Build reviewed AI systems."
    assert json.loads(db.execute("SELECT payload FROM source_evidence").fetchone()[0])["jobPostingInfo"]
    db.close()

print("workflow discovery: Python Workday discovery and immutable dedup passed")
