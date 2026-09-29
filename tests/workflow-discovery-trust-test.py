"""Check trust annotations remain advisory and source bounded."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.discovery_trust import trust

config = {"enabled": True}
assert trust({"url": "", "company": "Acme"}, config) == {
    "score": 60, "flags": ["missing_apply_url"], "level": "medium"}
assert trust({"url": "not a url", "company": "Acme"}, config)["flags"] == ["invalid_url"]
assert trust({"url": "https://bit.ly/1", "company": "Acme"}, config)["flags"] == [
    "suspicious_domain", "company_domain_mismatch"]
assert trust({"url": "https://acme.com/jobs/1", "company": "Acme"}, config)["score"] == 100
assert trust({"url": "https://boards.greenhouse.io/acme/jobs/1", "company": "Other"}, config)["score"] == 100
assert trust({"url": "https://societegenerale.com/jobs", "company": "Société Générale"}, config)["score"] == 100
assert trust({"url": "https://smithfield.com/jobs", "company": "Smith&Jones"}, config)["flags"] == ["company_domain_mismatch"]
assert trust({"url": "https://bit.ly/1", "company": "Acme"}, None)["score"] == 100
