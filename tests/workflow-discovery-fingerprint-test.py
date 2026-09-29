"""Check cross-listing fingerprints without claiming an inferred duplicate."""

from datetime import date
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.discovery_fingerprint import cross_listings, fingerprint, normalize_jd, similarity

body = "We build cloud services with Python and Kubernetes. " * 12
assert normalize_jd("<p>Python &amp; SQL</p> https://example.com/x") == "python sql"
first = fingerprint(body)
assert len(first) == 16 and similarity(first, first) == 1
assert fingerprint("short") == ""
offer = {"url": "https://agency.example.com/1", "company": "Agency", "title": "Engineer", "fingerprint": first}
row = {"url": "https://employer.example.com/1", "company": "Employer", "title": "Engineer",
       "dateStr": "2026-09-01", "fingerprint": first}
assert cross_listings([offer], [row], today=date(2026, 9, 28))[0]["score"] == 1
assert cross_listings([offer], [{**row, "company": "Agency"}], today=date(2026, 9, 28)) == []
assert cross_listings([offer], [{**row, "dateStr": "2026-01-01"}], today=date(2026, 9, 28)) == []
