"""Check browser observations route into retained offers and scan outcomes."""

from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import json
import sqlite3
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from career_ops.discovery.configured import discover
from career_ops.discovery.verify import observe, route
from career_ops import cli as career_ops


def offer(index: int) -> dict:
    return {"url": f"https://jobs.example.com/{index}", "company": "Example",
            "title": f"Engineer {index}", "tracked": True, "careersUrlDomain": "jobs.example.com"}


offers = [offer(index) for index in range(6)]
checks = [
    {"url": offers[0]["url"], "result": "active"},
    {"url": offers[1]["url"], "result": "uncertain", "code": "navigation_error"},
    {"url": offers[2]["url"], "result": "expired", "code": "http_gone"},
    {"url": offers[3]["url"], "result": "uncertain", "code": "blocked_host"},
    {"url": offers[4]["url"], "result": "uncertain", "code": "no_apply_control"},
    {"url": offers[5]["url"], "result": "expired", "code": "http_gone",
     "moved_url": "https://jobs.example.com/moved",
     "moved_check": {"result": "active"}},
]
retained, outcomes = route(offers, checks)
assert [row["url"] for row in retained] == [offers[0]["url"], offers[1]["url"],
                                            "https://jobs.example.com/moved"]
assert [(row["url"], status) for row, status in outcomes] == [
    (offers[2]["url"], "skipped_expired"),
    (offers[3]["url"], "skipped_blocked_host"),
    (offers[4]["url"], "skipped_no_apply_control"),
    (offers[5]["url"], "skipped_expired"),
]


def verified_batch(command, **kwargs):
    inputs = json.loads(Path(command[-2]).read_text())
    assert kwargs["timeout"] >= 20 * (120 + 16) + 60
    Path(command[-1]).write_text(json.dumps({"results": [
        {"url": item["url"], "result": "active"} for item in inputs["offers"]]}))
    return subprocess.CompletedProcess(command, 0, "", "")


with patch("career_ops.discovery.verify.subprocess.run", side_effect=verified_batch):
    assert len(observe([offer(index) for index in range(20)], throttle_ms=8000,
                       headed_fallback=True, rediscover_404=True)) == 20


def completed_before_timeout(command, **kwargs):
    Path(command[-1]).write_text(json.dumps({"results": [{"url": offer(0)["url"], "result": "active"}]}))
    raise subprocess.TimeoutExpired(command, kwargs["timeout"])


with patch("career_ops.discovery.verify.subprocess.run", side_effect=completed_before_timeout):
    assert observe([offer(0)]) == [{"url": offer(0)["url"], "result": "active"}]
with patch("career_ops.discovery.verify.subprocess.run", side_effect=subprocess.TimeoutExpired("node", 900)):
    try:
        observe([offer(0)])
    except subprocess.TimeoutExpired:
        pass
    else:
        raise AssertionError("An output-free verification timeout must fail")

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("""tracked_companies:
  - name: Fixture Defense
    careers_url: https://boards.example.com/fixture
    parser:
      command: node
      script: tests/fixtures/three-city-board.mjs
""")
    def reject(accepted, **options):
        assert len(accepted) == 1 and options["rediscover_404"] is False
        return [{"url": accepted[0]["url"], "result": "expired", "code": "http_gone"}]
    result = discover(root / "work", portals, verify=True, verification_observer=reject,
                      capture=lambda directory, url: None)
    assert result["checked"] == 3 and result["added"] == 0
    with sqlite3.connect(root / "work" / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 0
        assert db.execute("SELECT status FROM scan_outcomes").fetchone()[0] == "skipped_expired"

for flags, expected in (([], 0), (["--throttle"], 5000), (["--throttle=0"], 5000),
                        (["--throttle=8000"], 8000)):
    with patch.object(sys, "argv", ["career_ops", "discover", "--verify", *flags]), \
            patch.object(career_ops, "discover", return_value={"status": "completed"}) as operation, \
            redirect_stdout(StringIO()):
        career_ops.main()
    assert operation.call_args.kwargs["throttle_ms"] == expected
