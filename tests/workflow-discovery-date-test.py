"""Keep provider pagination hints and posting-date decisions on one window."""

from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.discovery import discover


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("tracked_companies:\n  - name: Date Fixture\n    provider: workday\n")
    seen = {}
    def collect(command, **kwargs):
        seen.update(json.loads(Path(command[-2]).read_text()))
        jobs = [{"company": "Date Fixture", "title": f"Engineer {index}",
                 "url": f"https://jobs.example.com/{index}",
                 "postedAt": datetime(year, 1, 1, tzinfo=timezone.utc).timestamp() * 1000}
                for index, year in enumerate((2024, 2025))]
        Path(command[-1]).write_text(json.dumps({"results": [
            {"status": "fetched", "provider": "workday", "jobs": jobs}]}))
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
    with patch("workflow.discovery.subprocess.run", side_effect=collect):
        result = discover(root / "work", portals, posted_after="2025-01-01",
                          capture=lambda directory, url: None)
    assert seen["since_ms"] == datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000
    assert result["checked"] == 2 and result["added"] == 1
    assert result["filtered"]["posted_date"] == 1
    try:
        discover(root / "invalid", portals, posted_after="2025-13-01")
    except ValueError as error:
            assert "--posted-after" in str(error)
    else:
        raise AssertionError("Invalid date must fail before collection")

for command in ("discover", "global"):
    duplicate = subprocess.run([sys.executable, "-B", "-m", "workflow.career_ops", command,
                                "--since=7", "--since", "1", "--help"],
                               cwd=ROOT, capture_output=True, text=True)
    assert duplicate.returncode == 2 and "--since given 2 times" in duplicate.stderr
