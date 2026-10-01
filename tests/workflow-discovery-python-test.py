"""Exercise provider collection through Python filtering and canonical SQLite storage."""

import sqlite3
import json
import os
import subprocess
import sys
import tempfile
import yaml
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.discovery import discover
from workflow.discovery_dedup import database_snapshot
from workflow.discovery_prescreen import candidate_source_hash
from workflow.discovery_store import DiscoveryStore

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
    output = root / "work"
    first = discover(output, portals, capture=lambda directory, url: None)
    assert first["status"] == "completed" and first["checked"] == 3 and first["added"] == 1
    assert first["filtered"]["dupes"] == 2
    second = discover(output, portals, capture=lambda directory, url: None)
    assert second["status"] == "completed" and second["added"] == 0 and second["filtered"]["dupes"] == 3
    db = sqlite3.connect(output / "opportunities.db")
    assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 1
    assert db.execute("SELECT count(*) FROM source_evidence").fetchone()[0] == 1
    assert db.execute("SELECT count(*) FROM scan_runs").fetchone()[0] == 2
    summaries = [json.loads(row[0]) for row in db.execute("SELECT summary FROM scan_runs ORDER BY id")]
    assert summaries[0]["filtered"]["dupes"] == 2
    assert summaries[1]["filtered"]["dupes"] == 3
    assert db.execute("SELECT count(*) FROM scan_observations").fetchone()[0] == 1
    db.close()

    second_lane = discover(root / "other-lane", portals, capture=lambda directory, url: None)
    shared_lane = discover(output, portals, capture=lambda directory, url: None)
    assert second_lane["added"] == 1 and shared_lane["added"] == 0
    run_id = json.loads((output / "cache" / "configured-discovery" / "latest.json").read_text())["run_id"]
    with sqlite3.connect(output / "opportunities.db") as db:
        run = db.execute("SELECT id FROM scan_runs WHERE run_id=?", (run_id,)).fetchone()[0]
        db.execute("DELETE FROM source_health WHERE scan_run_id=?", (run,))
        db.execute("DELETE FROM scan_runs WHERE id=?", (run,))
    assert discover(output, portals, capture=lambda directory, url: None, resume=True) == shared_lane
    with sqlite3.connect(output / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM scan_runs WHERE run_id=?", (run_id,)).fetchone()[0] == 1
    with sqlite3.connect(root / "other-lane" / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 1

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
    output = root / "work"
    original_scan_run_once = DiscoveryStore.scan_run_once
    def committed_run_then_failed(store, *args):
        original_scan_run_once(store, *args)
        raise RuntimeError("crash after business commit")
    with patch.object(DiscoveryStore, "scan_run_once", committed_run_then_failed):
        try:
            discover(output, portals, capture=lambda directory, url: None)
        except RuntimeError as error:
            assert str(error) == "crash after business commit"
        else:
            raise AssertionError("Expected injected crash")
    with patch("workflow.discovery.collect_provider_results", side_effect=AssertionError("collector repeated")):
        resumed = discover(output, portals, capture=lambda directory, url: None, resume=True)
    assert resumed["added"] == 1 and resumed["filtered"]["dupes"] == 2
    with sqlite3.connect(output / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM source_evidence").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM scan_runs").fetchone()[0] == 1

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
    output = root / "work"
    original_ingest = DiscoveryStore.ingest
    def committed_then_failed(store, offer, source, **kwargs):
        original_ingest(store, offer, source, **kwargs)
        raise RuntimeError("crash after opportunity commit")
    with patch.object(DiscoveryStore, "ingest", committed_then_failed):
        for resume in (False, True):
            try:
                discover(output, portals, capture=lambda directory, url: None, resume=resume)
            except RuntimeError as error:
                assert str(error) == "crash after opportunity commit"
            else:
                raise AssertionError("Expected injected crash")
    with sqlite3.connect(output / "opportunities.db") as db:
        failed = json.loads(db.execute("SELECT summary FROM scan_runs").fetchone()[0])
        assert failed["status"] == "failed" and failed["found"] == 3 and failed["newAdded"] == 0
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 1
    with patch("workflow.discovery.collect_provider_results", side_effect=AssertionError("collector repeated")):
        resumed = discover(output, portals, capture=lambda directory, url: None, resume=True)
    assert resumed["added"] == 1 and resumed["filtered"]["dupes"] == 2
    with sqlite3.connect(output / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM scan_runs").fetchone()[0] == 2

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("""tracked_companies:
  - name: Fixture Defense
    careers_url: https://boards.example.com/fixture
    parser:
      command: node
      script: tests/fixtures/three-city-board.mjs
  - name: Missing Provider
    provider: nonexistent-provider
  - name: Unconfigured Source
""")
    result = discover(root / "work", portals, capture=lambda directory, url: None)
    assert result["status"] == "partial" and result["added"] == 1
    assert result["errors"] == 2
    assert discover(root / "filtered", portals, company_filter="Missing Provider",
                           capture=lambda directory, url: None)["status"] == "failed"
    second = discover(root / "work", portals, capture=lambda directory, url: None)
    third = discover(root / "work", portals, capture=lambda directory, url: None)
    assert second["persistent_failures"] == []
    assert third["persistent_failures"] == []

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("tracked_companies:\n  - name: Partial Workday\n    provider: workday\n")
    def truncated_collection(command, **kwargs):
        Path(command[-1]).write_text(json.dumps({"results": [{"status": "fetched", "provider": "workday",
            "jobs": [{"company": "Partial Workday", "title": "Engineer",
                      "url": "https://example.com/job/partial"}], "truncated": True,
            "truncation_kind": "coverage_gap"}]}))
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
    with patch("workflow.discovery.subprocess.run", side_effect=truncated_collection):
        result = discover(root / "work", portals, capture=lambda directory, url: None)
    assert result["status"] == "partial" and result["added"] == 1
    assert result["errors"] == 1 and result["failures"][0]["kind"] == "coverage_warning"
    assert result["failures"][0]["reason"] == "coverage_gap"
    with sqlite3.connect(root / "work" / "opportunities.db") as db:
        assert db.execute("SELECT status FROM source_health").fetchone()[0] == "incomplete"
    with patch("workflow.discovery.subprocess.run", side_effect=truncated_collection):
        second = discover(root / "work", portals, capture=lambda directory, url: None)
        third = discover(root / "work", portals, capture=lambda directory, url: None)
    assert second["persistent_failures"] == []
    assert third["persistent_failures"] == ["Partial Workday"]

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("tracked_companies:\n  - name: Partial PCSX\n    provider: pcsx\n")
    def late_auth(command, **kwargs):
        Path(command[-1]).write_text(json.dumps({"results": [{"status": "fetched", "provider": "pcsx",
            "jobs": [{"company": "Partial PCSX", "title": "Engineer", "url": "https://example.com/job/1"}],
            "truncated": True, "truncation_kind": "auth"}]}))
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
    with patch("workflow.discovery.subprocess.run", side_effect=late_auth):
        partial = discover(root / "work", portals, capture=lambda directory, url: None)
    assert partial["status"] == "partial" and partial["added"] == 1
    assert partial["failures"][0]["reason"] == "auth"
    with sqlite3.connect(root / "work" / "opportunities.db") as db:
        assert db.execute("SELECT status FROM source_health").fetchone()[0] == "auth"

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("tracked_companies:\n  - name: Capped iCIMS\n    provider: icims\n")
    def capped_collection(command, **kwargs):
        Path(command[-1]).write_text(json.dumps({"results": [{"status": "fetched", "provider": "icims",
            "jobs": [{"company": "Capped iCIMS", "title": "Engineer",
                      "url": "https://example.com/job/icims-cap"}], "capped": True}]}))
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
    with patch("workflow.discovery.subprocess.run", side_effect=capped_collection):
        result = discover(root / "work", portals, capture=lambda directory, url: None)
    assert result["status"] == "partial" and result["added"] == 1
    assert result["failures"][0]["reason"] == "page_cap"
    with sqlite3.connect(root / "work" / "opportunities.db") as db:
        assert db.execute("SELECT status FROM source_health").fetchone()[0] == "incomplete"

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("""tracked_companies:
  - name: Fallback
    careers_url: https://example.com/jobs
    parser:
      command: node
      script: missing.mjs
""")
    def fallback_collection(command, **kwargs):
        Path(command[-1]).write_text(json.dumps({"results": [{"status": "fetched", "provider": "fixture",
            "jobs": [{"company": "Fallback", "title": "Engineer", "url": "https://example.com/fallback"}],
            "warning": "local parser failed, used API fallback: unavailable"}]}))
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
    with patch("workflow.discovery.subprocess.run", side_effect=fallback_collection):
        fallback = discover(root / "work", portals, capture=lambda directory, url: None)
    assert fallback["status"] == "partial" and fallback["added"] == 1 and fallback["errors"] == 1
    with sqlite3.connect(root / "work" / "opportunities.db") as db:
        assert db.execute("SELECT source FROM opportunities").fetchone()[0] == "fixture-api"
        assert db.execute("SELECT status FROM source_health").fetchone()[0] == "reachable"

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("tracked_companies:\n  - name: Collector Failure\n    provider: greenhouse\n")
    with patch("workflow.discovery.subprocess.run", side_effect=subprocess.TimeoutExpired("node", 900)):
        failed = discover(root / "work", portals)
    assert failed == {"status": "failed", "error": "Provider scanner exceeded its 900-second budget"}
    with sqlite3.connect(root / "work" / "opportunities.db") as db:
        summary = json.loads(db.execute("SELECT summary FROM scan_runs").fetchone()[0])
        assert summary["status"] == "failed" and summary["newAdded"] == 0
        assert db.execute("SELECT count(*) FROM source_health").fetchone()[0] == 0
    with patch("workflow.discovery.subprocess.run", side_effect=subprocess.TimeoutExpired("node", 900)):
        preview = discover(root / "dry-run", portals, dry_run=True)
    assert preview["status"] == "failed" and not (root / "dry-run").exists()
    with patch("workflow.discovery.subprocess.run", side_effect=KeyboardInterrupt):
        try:
            discover(root / "interrupted", portals)
        except KeyboardInterrupt:
            pass
        else:
            raise AssertionError("Expected interrupted collection")
    with sqlite3.connect(root / "interrupted" / "opportunities.db") as db:
        interrupted = json.loads(db.execute("SELECT summary FROM scan_runs").fetchone()[0])
        assert interrupted["status"] == "failed" and interrupted["newAdded"] == 0
    def finished_then_hung(command, **kwargs):
        Path(command[-1]).write_text(json.dumps({"results": [{"status": "fetched", "provider": "greenhouse",
                                                         "jobs": []}]}))
        raise subprocess.TimeoutExpired(command, kwargs["timeout"])
    with patch("workflow.discovery.subprocess.run", side_effect=finished_then_hung):
        recovered = discover(root / "late-exit", portals)
    assert recovered["status"] == "completed" and recovered["checked"] == 0

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("tracked_companies:\n  - name: Collector Failure\n    provider: greenhouse\n")
    original = DiscoveryStore.scan_run_once
    interrupted = [False]

    def commit_then_interrupt(self, *args):
        run = original(self, *args)
        if not interrupted[0]:
            interrupted[0] = True
            raise RuntimeError("checkpoint interrupted after failure commit")
        return run

    with patch.object(DiscoveryStore, "scan_run_once", commit_then_interrupt), \
            patch("workflow.discovery.subprocess.run", side_effect=subprocess.TimeoutExpired("node", 900)):
        try:
            discover(root / "work", portals)
        except RuntimeError as error:
            assert str(error) == "checkpoint interrupted after failure commit"
        else:
            raise AssertionError("Expected checkpoint interruption")
        assert discover(root / "work", portals, resume=True)["status"] == "failed"
    with sqlite3.connect(root / "work" / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM scan_runs").fetchone()[0] == 1

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("tracked_companies:\n  - name: Decision Failure\n    provider: greenhouse\n")

    def malformed(command, **kwargs):
        Path(command[-1]).write_text(json.dumps({"results": [
            {"status": "fetched", "provider": "greenhouse", "jobs": {}}]}))
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    with patch("workflow.discovery.subprocess.run", side_effect=malformed):
        for resume in (False, True):
            try:
                discover(root / "work", portals, resume=resume)
            except ValueError as error:
                assert str(error) == "Provider result jobs must be a list"
            else:
                raise AssertionError("Malformed provider jobs must fail during decision")
    with sqlite3.connect(root / "work" / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM scan_runs").fetchone()[0] == 1

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("tracked_companies:\n" + "".join(
        f"  - name: Board {number}\n    provider: greenhouse\n" for number in range(11)))
    def observe_budget(command, **kwargs):
        assert kwargs["timeout"] == 1260
        Path(command[-1]).write_text(json.dumps({"results": [{"status": "fetched", "provider": "greenhouse", "jobs": []}] * 11}))
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
    with patch("workflow.discovery.subprocess.run", side_effect=observe_budget):
        assert discover(root / "work", portals)["status"] == "completed"

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
    (root / "data").mkdir()
    (root / "data" / "blacklist.md").write_text("| Company | Since | Scope | Reason |\n| Fixture Defense | 2026-01-01 | all | user decision |\n")
    skipped = discover(root / "skipped", portals, capture=lambda directory, url: None)
    assert skipped["added"] == 0 and skipped["filtered"]["blacklist"] == 3
    audited = discover(root / "audited", portals, include_blacklisted=True,
                       capture=lambda directory, url: None)
    assert audited["added"] == 1 and audited["annotated_blacklisted"] == 3
    with sqlite3.connect(root / "audited" / "opportunities.db") as db:
        payload = json.loads(db.execute("SELECT payload FROM source_evidence").fetchone()[0])
    assert payload["blacklisted"] is True and payload["note"] == "blacklisted: user decision"

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
    output = root / "work"
    preview = discover(output, portals, dry_run=True)
    assert preview["dry_run"] is True and preview["added"] == 1
    assert not output.exists()
    committed = discover(output, portals, capture=lambda directory, url: None)
    assert committed["added"] == 1
    database = output / "opportunities.db"
    before = database.read_bytes()
    repeat = discover(output, portals, dry_run=True)
    assert repeat["added"] == 0 and repeat["filtered"]["dupes"] == 3
    assert database.read_bytes() == before

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    (root / "portals.yml").write_text("[]\n")
    alternate = root / "alternate" / "portals.yml"
    alternate.parent.mkdir()
    alternate.write_text("tracked_companies:\n  - name: Fixture Defense\n    careers_url: https://boards.example.com/fixture\n    parser:\n      command: node\n      script: " + str(ROOT / "tests" / "fixtures" / "three-city-board.mjs") + "\n")
    profile = root / "alternate-profile.yml"
    profile.write_text("location:\n  country: Hong Kong\n")
    (root / "cv.md").write_text("# Candidate\n")
    (root / "modes").mkdir()
    (root / "modes" / "_profile.md").write_text("Targeting\n")
    preview = subprocess.run([str(ROOT / "workflow" / ".venv" / "bin" / "python"), "-B", "-m", "workflow.career_ops",
                              "--directory", str(root / "preview"), "discover", "--dry-run"], cwd=ROOT,
                             env={**os.environ, "CAREER_OPS_INPUT_ROOT": str(root), "CAREER_OPS_PORTALS": str(alternate),
                                  "CAREER_OPS_PROFILE": str(profile)}, capture_output=True, text=True, timeout=90)
    assert preview.returncode == 0, preview.stderr
    assert json.loads(preview.stdout)["checked"] == 3
    assert not (root / "preview" / "opportunities.db").exists()
    global_preview = subprocess.run([str(ROOT / "workflow" / ".venv" / "bin" / "python"), "-B", "-m", "workflow.career_ops",
                                     "--directory", str(root / "global-preview"), "global", "--dry-run", "--ats=,"], cwd=ROOT,
                                    env={**os.environ, "CAREER_OPS_INPUT_ROOT": str(root), "CAREER_OPS_PORTALS": str(alternate)},
                                    capture_output=True, text=True, timeout=90)
    assert global_preview.returncode == 0, global_preview.stderr
    assert json.loads(global_preview.stdout)["status"] == "completed"
    result = discover(root / "committed", alternate, capture=lambda directory, url: None,
                      input_root=root, profile_path=profile)
    assert result["added"] == 1
    cache = next((root / "committed" / "prescreen-cache").glob("*.json"))
    assert json.loads(cache.read_text())["input"]["candidate_source_hash"] == candidate_source_hash(root, profile)

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    for index, (value, expected) in enumerate((("7days", 7), ("3.5", 3), ("true", None))):
        portals.write_text(f"scan_history:\n  recheck_after_days: {value}\ntracked_companies: []\n")
        with patch("workflow.discovery.database_snapshot", wraps=database_snapshot) as snapshot:
            discover(root / f"recheck-{index}", portals)
        assert snapshot.call_args.kwargs["recheck_after_days"] == expected

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    portals = root / "portals.yml"
    portals.write_text("job_boards:\n  - name: Shared Search\n    provider: search\n")
    profile = root / "selected-profile.yml"
    observed = []
    def collected_search(command, **kwargs):
        request = json.loads(Path(command[-2]).read_text())
        observed.append(request["search_keywords"])
        word = request["search_keywords"][0]
        address = "https://jobs.example.com/" + str(len(observed))
        text = "Responsibilities and qualifications for " + word
        Path(command[-1]).write_text(json.dumps({"results": [{"status": "fetched", "provider": "search",
            "queries": ["site:jobs.example.com " + word], "jobs": [{"company": "Employer", "title": word,
            "url": address, "description": text, "scan_jd": {"text": text, "final_url": address,
            "retrieved_at": "2026-10-01T00:00:00Z"}}]}]}))
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
    for word in ["AI Engineer", "智能体工程师"]:
        profile.write_text(yaml.safe_dump({"target_roles": {"search_keywords": [word]}}))
        with patch("workflow.discovery.subprocess.run", side_effect=collected_search):
            result = discover(root / "work", portals, profile_path=profile,
                              capture=lambda *_: (_ for _ in ()).throw(AssertionError("JD read repeated")))
        assert result["status"] == "completed" and result["added"] == 1, result
        assert result["searches"][0]["queries"] == ["site:jobs.example.com " + word]
    assert observed == [["AI Engineer"], ["智能体工程师"]]
    with sqlite3.connect(root / "work/opportunities.db") as db:
        payload = json.loads(db.execute("SELECT payload FROM source_evidence ORDER BY id DESC LIMIT 1").fetchone()[0])
        assert payload["scan_jd"]["content_hash"] and payload["description"] == payload["scan_jd"]["text"]
    print("Configured search: selected profile refresh, query evidence and JD publication passed")
