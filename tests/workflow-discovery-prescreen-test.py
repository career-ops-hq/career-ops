"""Check Stage 0 never turns listing metadata into a completed assessment."""

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.discovery_prescreen import candidate_source_hash, placeholder, write_placeholder

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    (root / "modes").mkdir()
    (root / "cv.md").write_text("# CV\n")
    (root / "modes" / "_profile.md").write_text("Rules")
    profile = root / "profile.yml"
    profile.write_text("location: China\n")
    source_hash = candidate_source_hash(root, profile)
    offer = {"url": "https://jobs.example.com/123", "title": "Engineer", "company": "Acme",
             "location": "Beijing", "description": "Listing metadata only"}
    source, result = placeholder(offer, source_hash)
    assert source["complete_jd"] is False and source["assessment_complete"] is False
    assert result["status"] == "incomplete"
    assert "complete_jd" in result["missing"] and "gates.location" in result["missing"]
    path = write_placeholder(offer, source_hash, root / "cache")
    assert json.loads(path.read_text())["result"]["input_hash"] == result["input_hash"]
