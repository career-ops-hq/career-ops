"""Check Python portal repairs against the original line-preserving Node edit."""

import json
from contextlib import redirect_stdout
from io import StringIO
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from career_ops.discovery import portals_repair
from career_ops.discovery.portals_repair import compute_fixes, repair_file


RAW = """tracked_companies:
  - name: Alpha Labs
    careers_url: https://boards.greenhouse.io/oldalpha
    api: https://boards-api.greenhouse.io/v1/boards/oldalpha/jobs
    notes: old note # keep this
    enabled: true
  - name: Beta Tech
    careers_url: https://jobs.ashbyhq.com/oldbeta
    notes: "quoted \\"value\\"" # annotation
    enabled: true
  - name: Gamma
    careers_url: https://jobs.lever.co/oldgamma
    notes: |
      first line
      second line
    enabled: true
  - name: Delta
    careers_url: https://jobs.ashbyhq.com/delta
    enabled: true
"""
RESULTS = [
    {"name": "Alpha Labs", "ats": "greenhouse", "status": "missing",
     "suggested": {"ats": "ashby", "slug": "alphalabs"}},
    {"name": "Delta", "ats": "ashby", "status": "empty",
     "suggested": {"ats": "greenhouse", "slug": "delta"}},
    {"name": "Gamma", "ats": "lever", "status": "missing",
     "suggested": {"ats": "lever", "slug": "gamma", "eu": True}},
    {"name": "Beta Tech", "ats": "ashby", "status": "missing",
     "suggested": {"ats": "greenhouse", "slug": "betatech"}},
]

expected = json.loads((ROOT / "tests/fixtures/portal-repair-node-output.json").read_text())
actual = compute_fixes(RAW, RESULTS, day="2026-09-29")
assert actual == expected, (actual, expected)
assert compute_fixes(actual["text"], [], day="2026-09-29")["text"] == actual["text"]

with TemporaryDirectory() as directory:
    portal = Path(directory) / "portals.yml"
    portal.write_text(RAW)
    verify = lambda company: next((row for row in RESULTS if row["name"] == company["name"]), None)
    preview = repair_file(portal, verify=verify)
    assert portal.read_text() == RAW and len(preview) == 3
    written = repair_file(portal, apply=True, verify=verify)
    assert written == preview
    assert "https://jobs.ashbyhq.com/alphalabs" in portal.read_text()
    assert "boards-api.greenhouse.io/v1/boards/oldalpha" not in portal.read_text()

    for arguments in (["--file", str(portal), "--unknown"], ["--file"], ["--file="]):
        command = subprocess.run([sys.executable, "-m", "career_ops", "portal", "repair", *arguments],
                                 cwd=ROOT, text=True, capture_output=True)
        assert command.returncode != 0 and "error:" in command.stderr

    missing = subprocess.run([sys.executable, "-m", "career_ops", "portal", "repair",
                              "--file", str(Path(directory) / "missing.yml")],
                             cwd=ROOT, text=True, capture_output=True, check=True)
    assert "nothing to fix" in missing.stdout

    (Path(directory) / ".env").write_text("CAREER_OPS_ALLOW_FAKE_IP_RANGE=1\n")
    with patch.object(portals_repair, "ROOT", Path(directory)), \
            patch.dict(os.environ, {}, clear=True), redirect_stdout(StringIO()):
        assert portals_repair.main(["--file", str(Path(directory) / "missing.yml")]) == 0
        assert os.environ["CAREER_OPS_ALLOW_FAKE_IP_RANGE"] == "1"

print("workflow portal repair: Node line-preserving baseline passed")
