"""Check the Python reverse sweep's real SQLite handoff and interrupted replay."""

import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

from langgraph.checkpoint.sqlite import SqliteSaver

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from workflow.reverse_checkpoint import write_checkpoint
from workflow.reverse_runner import (collect_boards, directory_concurrency, discover_global, enrich_dates,
                                     load_seed, publish_reverse_offers, seed_entry)


NOW = 1_800_000_000_000
BOARDS = [f"board{index}" for index in range(51)]
same_host = [{"careers_url": f"https://wd1.wd1.myworkdayjobs.com/site-{index}"} for index in range(2)]
distinct_hosts = [{"careers_url": f"https://company-{index}.wd1.myworkdayjobs.com/site"} for index in range(2)]
assert directory_concurrency("workday", same_host) == 1
assert directory_concurrency("workday", distinct_hosts) == 20
assert directory_concurrency("greenhouse", distinct_hosts) == 6


def enriched_then_hung(command, **kwargs):
    Path(command[-1] + ".progress").write_text(json.dumps({"index": 0, "job": {"title": "Engineer",
                                                               "postedAt": NOW - 1000}}) + "\n")
    raise subprocess.TimeoutExpired(command, kwargs["timeout"])


with patch("workflow.reverse_runner.subprocess.run", side_effect=enriched_then_hung):
    enriched, complete = enrich_dates([{"title": "Engineer"}, {"title": "Engineer II"}], timeout_seconds=1)
    assert not complete and len(enriched) == 1 and enriched[0]["postedAt"] == NOW - 1000


def completed_then_hung(command, **kwargs):
    assert kwargs["timeout"] == 900
    Path(command[-1]).write_text(json.dumps({"results": [{"status": "unmatched"}] * 7}))
    raise subprocess.TimeoutExpired(command, kwargs["timeout"])


with patch("workflow.reverse_runner.subprocess.run", side_effect=completed_then_hung):
    assert len(collect_boards([{"name": f"board{index}"} for index in range(7)], NOW, False, 6)) == 7


def partial_then_hung(command, **kwargs):
    progress = Path(command[-1] + ".progress")
    progress.write_text('\n'.join([
        json.dumps({"index": 0, "row": {"status": "fetched", "jobs": []}}),
        json.dumps({"index": 2, "row": {"status": "fetched", "jobs": []}}),
    ]) + '\n')
    raise subprocess.TimeoutExpired(command, kwargs["timeout"])


with patch("workflow.reverse_runner.subprocess.run", side_effect=partial_then_hung):
    partial = collect_boards([{"name": name} for name in ("first", "slow", "last")], NOW, False, 6)
    assert [row["status"] if row else None for row in partial] == ["fetched", None, "fetched"]
with patch("workflow.reverse_runner.subprocess.run", side_effect=subprocess.TimeoutExpired("node", 900)):
    try:
        collect_boards([{"name": "unfetched"}], NOW, False, 6)
    except subprocess.TimeoutExpired:
        pass
    else:
        raise AssertionError("A timed-out collector without output must remain incomplete")
try:
    collect_boards([], NOW, False, 0)
except ValueError:
    pass
else:
    raise AssertionError("Invalid collector concurrency must fail before launching Node")


def seed_finished_then_hung(command, **kwargs):
    seed = json.loads(Path(command[-2]).read_text())["seed"]
    assert kwargs["timeout"] == (10_060 if seed == "yc" else 900)
    Path(command[-1]).write_text(json.dumps({"companies": [{"name": seed}], "partial": False}))
    raise subprocess.TimeoutExpired(command, kwargs["timeout"])


with patch("workflow.reverse_runner.subprocess.run", side_effect=seed_finished_then_hung):
    assert load_seed("yc")["companies"] == [{"name": "yc"}]
    assert load_seed("a16z")["companies"] == [{"name": "a16z"}]
with patch("workflow.reverse_runner.subprocess.run", side_effect=subprocess.TimeoutExpired("node", 10_060)):
    try:
        load_seed("yc")
    except subprocess.TimeoutExpired:
        pass
    else:
        raise AssertionError("An unfinished portfolio collection must remain incomplete")


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    config = root / "portals.yml"
    config.write_text("title_filter:\n  positive:\n    - Engineer\nlocation_filter:\n  allow:\n    - Shanghai\n")

    def one_board(name, cache):
        return ["acme"], "ok"

    def one_offer(targets, cutoff_ms, include_undated, concurrency):
        return [{"status": "fetched", "provider": "greenhouse", "jobs": [{
            "company": "Acme", "title": "Engineer", "url": "https://job-boards.greenhouse.io/acme/jobs/1",
            "location": "Shanghai", "description": "Build systems", "postedAt": NOW - 1000,
        }]}]

    lane = root / "data"
    with patch("workflow.reverse_runner.decide_reverse_offers", side_effect=RuntimeError("after source sweep")):
        try:
            discover_global(lane, config, ats=["greenhouse"], collect=one_offer,
                            load_source=one_board, now_ms=NOW)
        except RuntimeError as error:
            assert str(error) == "after source sweep"
        else:
            raise AssertionError("Expected final-decision interruption")
    saved = json.loads((lane / "cache" / "ats-full-checkpoint.json").read_text())
    assert saved["completed_sources"] == ["greenhouse"] and len(saved["offers"]) == 1

    def no_recollection(*args):
        raise AssertionError("Completed source fetched again")

    recovered = discover_global(lane, config, ats=["greenhouse"], resume=True,
                                collect=no_recollection, load_source=one_board, now_ms=NOW + 10_000)
    assert recovered["status"] == "completed" and recovered["postingsKept"] == 1
    assert recovered["companiesAvailable"] == recovered["companiesScanned"] == 1
    assert recovered["datasetStatus"] == {"greenhouse": "ok"}
    with sqlite3.connect(lane / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM scan_runs").fetchone()[0] == 1

    publish_lane = root / "publish-interruption"
    verification_calls = []

    def verify_once(offers):
        verification_calls.append(len(offers))
        return [{"url": offer["url"], "result": "active"} for offer in offers]

    with patch("workflow.reverse_runner.publish_reverse_offers", side_effect=RuntimeError("before publish")):
        try:
            discover_global(publish_lane, config, ats=["greenhouse"], collect=one_offer,
                            load_source=one_board, liveness=True, verify=verify_once, now_ms=NOW)
        except RuntimeError as error:
            assert str(error) == "before publish"
        else:
            raise AssertionError("Expected publication interruption")
    assert verification_calls == [1]
    publish_checkpoint = publish_lane / "cache" / "ats-full-checkpoint.json"
    assert publish_checkpoint.is_file()
    saved_run = json.loads(publish_checkpoint.read_text())
    graph_path = publish_lane / "cache" / "reverse-discovery" / "checkpoints.db"
    with SqliteSaver.from_conn_string(str(graph_path)) as saver:
        graph_state = saver.get_tuple({"configurable": {"thread_id": f'{saved_run["run_id"]}:0'}})
        assert graph_state and graph_state.checkpoint["channel_values"]["decision"]["sha256"]
        assert "offers" not in graph_state.checkpoint["channel_values"]
    decision_path = publish_lane / "cache" / "reverse-discovery" / saved_run["run_id"] / "0" / "decision.json"
    original_decision = decision_path.read_bytes()
    decision_path.write_bytes(original_decision + b" ")
    try:
        discover_global(publish_lane, config, ats=["greenhouse"], resume=True,
                        collect=no_recollection, load_source=one_board, liveness=True,
                        verify=lambda *_: (_ for _ in ()).throw(AssertionError("decision verified twice")), now_ms=NOW)
    except ValueError as error:
        assert "artifact changed" in str(error)
    else:
        raise AssertionError("Changed decision artifact must not publish")
    decision_path.write_bytes(original_decision)
    published = discover_global(publish_lane, config, ats=["greenhouse"], resume=True,
                                collect=no_recollection, load_source=one_board, liveness=True,
                                verify=lambda *_: (_ for _ in ()).throw(AssertionError("decision verified twice")),
                                now_ms=NOW + 10_000)
    assert published["status"] == "completed" and published["postingsKept"] == 1
    assert not (publish_lane / "cache" / "ats-full-checkpoint.json").exists()
    with SqliteSaver.from_conn_string(str(graph_path)) as saver:
        completed_graph = saver.get_tuple({"configurable": {"thread_id": f'{saved_run["run_id"]}:0'}})
        assert completed_graph.checkpoint["channel_values"]["result"]["sha256"]
        assert "offers" not in completed_graph.checkpoint["channel_values"]

    changed_lane = root / "changed-decision-inputs"
    with patch("workflow.reverse_runner.publish_reverse_offers", side_effect=RuntimeError("before publish")):
        try:
            discover_global(changed_lane, config, ats=["greenhouse"], collect=one_offer,
                            load_source=one_board, now_ms=NOW)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Expected publication interruption")
    changed = discover_global(changed_lane, config, ats=["greenhouse"], resume=True,
                              collect=no_recollection, load_source=one_board, liveness=True,
                              verify=lambda offers: [{"url": offer["url"], "result": "expired"} for offer in offers],
                              now_ms=NOW + 10_000)
    assert changed["postingsKept"] == 0 and changed["status"] == "completed"
    with sqlite3.connect(changed_lane / "opportunities.db") as db:
        changed_run = db.execute("SELECT run_id FROM scan_runs").fetchone()[0]
    assert (changed_lane / "cache" / "reverse-discovery" / changed_run / "1" / "decision.json").is_file()

    blacklist_lane = root / "changed-blacklist"
    blacklist_root = root / "blacklist-input"
    (blacklist_root / "data").mkdir(parents=True)
    with patch("workflow.reverse_runner.publish_reverse_offers", side_effect=RuntimeError("before publish")):
        try:
            discover_global(blacklist_lane, config, ats=["greenhouse"], collect=one_offer,
                            load_source=one_board, input_root=blacklist_root, now_ms=NOW)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Expected publication interruption")
    (blacklist_root / "data" / "blacklist.md").write_text("| Company | Since | Scope | Reason |\n| --- | --- | --- | --- |\n"
                                                       "| Acme | 2026-09-29 | all | test |\n")
    blacklisted = discover_global(blacklist_lane, config, ats=["greenhouse"], resume=True,
                                  collect=no_recollection, load_source=one_board,
                                  input_root=blacklist_root, now_ms=NOW + 10_000)
    assert blacklisted["postingsKept"] == 0 and blacklisted["postingsFilteredBlacklist"] == 1

    seed_lane = root / "seed-stage-interruption"
    seed_company = [{"name": "Seed", "url": "https://example.org"}]
    try:
        discover_global(seed_lane, config, ats=["greenhouse"], seeds=["yc"], collect=one_offer,
                        load_source=one_board, load_portfolio=lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()),
                        now_ms=NOW)
    except KeyboardInterrupt:
        pass
    else:
        raise AssertionError("Expected seed-stage interruption")
    seed_recovered = discover_global(seed_lane, config, ats=["greenhouse"], seeds=["yc"], resume=True,
                                     collect=no_recollection, load_source=one_board,
                                     load_portfolio=lambda *_: seed_company, now_ms=NOW + 10_000)
    assert seed_recovered["companiesAvailable"] == 2 and seed_recovered["companiesScanned"] == 2
    assert seed_recovered["postingsKept"] == 1 and seed_recovered["datasetStatus"] == {
        "greenhouse": "ok", "yc": "ok"}

    committed_lane = root / "committed-before-graph"

    def committed_then_crashed(*args, **kwargs):
        publish_reverse_offers(*args, **kwargs)
        raise RuntimeError("after business commit")

    with patch("workflow.reverse_runner.publish_reverse_offers", side_effect=committed_then_crashed):
        try:
            discover_global(committed_lane, config, ats=["greenhouse"], collect=one_offer,
                            load_source=one_board, now_ms=NOW)
        except RuntimeError as error:
            assert str(error) == "after business commit"
        else:
            raise AssertionError("Expected graph persistence interruption")
    replayed = discover_global(committed_lane, config, ats=["greenhouse"], resume=True,
                               collect=no_recollection, load_source=one_board, now_ms=NOW + 10_000)
    assert replayed["postingsKept"] == 1
    with sqlite3.connect(committed_lane / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM scan_runs").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM source_health").fetchone()[0] == 1


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    config = root / "portals.yml"
    config.write_text("title_filter:\n  positive:\n    - Engineer\nlocation_filter:\n  allow:\n    - Shanghai\n")
    lane = root / "data"
    calls = []

    def interrupted_batch(targets, *_):
        calls.append([target["name"] for target in targets])
        rows = [{"status": "fetched", "jobs": [{"company": target["name"], "title": "Engineer",
                 "url": f'https://jobs.example.com/{target["name"]}', "location": "Shanghai",
                 "description": "Build", "postedAt": NOW - 1000}]} for target in targets]
        if len(calls) == 1:
            rows[1] = None
        return rows

    first = discover_global(lane, config, ats=["greenhouse"], collect=interrupted_batch,
                            load_source=lambda *_: (["first", "slow", "last"], "ok"), now_ms=NOW)
    checkpoint = lane / "cache" / "ats-full-checkpoint.json"
    assert first["stoppedByOutage"] and first["companiesScanned"] == first["postingsKept"] == 1
    assert json.loads(checkpoint.read_text())["current"]["resume_at"] == 1
    resumed = discover_global(lane, config, ats=["greenhouse"], collect=interrupted_batch,
                              load_source=lambda *_: (["first", "slow", "last"], "ok"), resume=True, now_ms=NOW)
    assert calls == [["first", "slow", "last"], ["slow", "last"]]
    assert resumed["companiesScanned"] == resumed["postingsKept"] == 3
    assert not checkpoint.exists()


def source(name, cache):
    assert name == "greenhouse"
    return BOARDS, "ok"


calls = []
fail_second = True


def collect(targets, cutoff_ms, include_undated, concurrency):
    global fail_second
    calls.append([target["name"] for target in targets])
    assert cutoff_ms == NOW - 3 * 86_400_000
    assert not include_undated and concurrency == 6
    if fail_second and targets[0]["name"] == "board50":
        fail_second = False
        raise RuntimeError("collector interrupted")
    return [{"status": "fetched", "provider": "greenhouse", "jobs": [{
        "company": target["name"], "title": "Engineer", "url": f'https://job-boards.greenhouse.io/{target["name"]}/jobs/1',
        "location": "Shanghai", "description": "Build systems", "postedAt": NOW - 1000,
    }]} for target in targets]


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    config = root / "portals.yml"
    config.write_text("title_filter:\n  positive:\n    - Engineer\nlocation_filter:\n  allow:\n    - Shanghai\n")
    data = root / "data"
    first = discover_global(data, config, ats=["greenhouse"], collect=collect, load_source=source, now_ms=NOW)
    checkpoint = data / "cache" / "ats-full-checkpoint.json"
    assert first["status"] == "partial" and first["stoppedByOutage"] and first["resumable"]
    assert first["companiesScanned"] == first["postingsKept"] == 50 and checkpoint.is_file()
    saved_checkpoint = json.loads(checkpoint.read_text())
    assert saved_checkpoint["current"]["resume_at"] == 50

    resumed_preview = discover_global(data, config, ats=["greenhouse"], resume=True, dry_run=True,
                                      collect=collect, load_source=source, now_ms=NOW + 10_000)
    assert resumed_preview["dry_run"] and resumed_preview["resumed"]
    assert resumed_preview["postingsKept"] == 51 and checkpoint.is_file()
    assert json.loads(checkpoint.read_text()) == saved_checkpoint

    fresh_data = root / "fresh-checkpoint"
    fresh_checkpoint = fresh_data / "cache" / "ats-full-checkpoint.json"
    assert write_checkpoint(fresh_checkpoint, {**saved_checkpoint, "cutoff_ms": NOW - 7 * 86_400_000})
    fresh_preview = discover_global(fresh_data, config, ats=["greenhouse"], dry_run=True,
                                    collect=collect, load_source=source, now_ms=NOW)
    assert fresh_preview["dry_run"] and not fresh_preview["resumed"] and fresh_preview["postingsKept"] == 51
    assert json.loads(fresh_checkpoint.read_text())["cutoff_ms"] == NOW - 7 * 86_400_000
    try:
        discover_global(fresh_data, config, ats=["greenhouse"],
                        load_source=lambda *_: (_ for _ in ()).throw(RuntimeError("source unavailable")), now_ms=NOW)
    except RuntimeError as error:
        assert str(error) == "source unavailable"
    else:
        raise AssertionError("Source failure must propagate")
    assert json.loads(fresh_checkpoint.read_text())["cutoff_ms"] == NOW - 7 * 86_400_000
    fresh = discover_global(fresh_data, config, ats=["greenhouse"],
                            collect=collect, load_source=source, now_ms=NOW)
    assert fresh["status"] == "completed" and not fresh["resumed"]
    assert fresh["companiesScanned"] == fresh["postingsKept"] == 51
    assert not fresh_checkpoint.exists() and calls[-2][0] == "board0"

    resumed = discover_global(data, config, ats=["greenhouse"], resume=True,
                              collect=collect, load_source=source, now_ms=NOW + 10_000)
    assert resumed["status"] == "partial" and resumed["resumed"] and not resumed["stoppedByOutage"]
    assert resumed["companiesAvailable"] == resumed["companiesScanned"] == resumed["postingsKept"] == 51
    assert not checkpoint.exists() and calls[-1] == ["board50"]
    with sqlite3.connect(data / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 51
        assert db.execute("SELECT count(*) FROM scan_runs WHERE operation='global'").fetchone()[0] == 1
        assert json.loads(db.execute("SELECT summary FROM scan_runs WHERE operation='global'").fetchone()[0])["stopped"] is False
        assert db.execute("SELECT status FROM source_health WHERE source='greenhouse'").fetchone()[0] == "incomplete"
        offers = [json.loads(row[0]) for row in db.execute("SELECT payload FROM source_evidence ORDER BY opportunity_id")]
    lagging = {**saved_checkpoint, "completed_sources": ["greenhouse"], "current": None, "offers": offers,
               "source_health": [{"company": "greenhouse", "status": "reachable", "timestamp": "2026-01-01T00:00:00Z"}],
               "counters": {**saved_checkpoint["counters"], "companies_scanned": 51}}
    assert write_checkpoint(checkpoint, lagging)
    replay = discover_global(data, config, ats=["greenhouse"], resume=True,
                             collect=lambda *_: (_ for _ in ()).throw(AssertionError("completed source refetched")),
                             load_source=source, now_ms=NOW + 20_000)
    assert replay["postingsKept"] == 51 and not checkpoint.exists()
    with sqlite3.connect(data / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 51
        assert db.execute("SELECT count(*) FROM scan_runs WHERE operation='global'").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM source_health").fetchone()[0] == 1

    enrichment_calls = []

    def collect_icims(targets, *_):
        return [{"status": "fetched", "provider": "icims", "deadline_ms": time.time() * 1000 + 300_000, "jobs": [
            {"company": "Acme", "title": "Engineer", "location": "Shanghai",
             "url": "https://careers-acme.icims.com/jobs/1/engineer/job"},
            {"company": "Acme", "title": "Sales", "location": "Seattle",
             "url": "https://careers-acme.icims.com/jobs/2/sales/job"},
        ]}]

    def enrich_icims(jobs, *, timeout_seconds):
        assert 299 < timeout_seconds <= 300
        enrichment_calls.extend(jobs)
        return [{**job, "postedAt": NOW - 1000} for job in jobs], True

    icims = discover_global(root / "icims", config, ats=["icims"], collect=collect_icims,
                            load_source=lambda name, cache: (["acme"], "ok"), enrich=enrich_icims, now_ms=NOW)
    assert icims["postingsKept"] == 1 and icims["postingsDroppedNoDate"] == 1
    assert [job["title"] for job in enrichment_calls] == ["Engineer"]

    remaining = []

    def slow_icims(targets, *_):
        return [{**row, "deadline_ms": time.time() * 1000 + 1000} for row in collect_icims(targets)]

    def bounded_enrich(jobs, *, timeout_seconds):
        remaining.append(timeout_seconds)
        return [{**job, "postedAt": NOW - 1000} for job in jobs], True

    bounded = discover_global(root / "icims-budget", config, ats=["icims"], collect=slow_icims,
                              load_source=lambda *_: (["acme"], "ok"), enrich=bounded_enrich, now_ms=NOW)
    assert len(remaining) == 1 and 0 < remaining[0] <= 1 and bounded["postingsKept"] == 1

    expired = discover_global(root / "icims-expired", config, ats=["icims"],
                              collect=lambda targets, *_: [{**row, "deadline_ms": time.time() * 1000 - 1} for row in collect_icims(targets)],
                              load_source=lambda *_: (["acme"], "ok"),
                              enrich=lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("expired budget must not enrich")),
                              now_ms=NOW)
    assert expired["status"] == "partial" and expired["postingsKept"] == 0 and expired["unreachableBoards"] == 1

    def collect_partial(targets, *_):
        row = collect_icims(targets)[0]
        jobs = row["jobs"]
        return [{**row, "jobs": [jobs[0], {**jobs[0], "title": "Engineer II",
                 "url": "https://careers-acme.icims.com/jobs/3/engineer-ii/job"}, jobs[1]]}]

    partial = discover_global(root / "icims-partial", config, ats=["icims"], collect=collect_partial,
                              load_source=lambda *_: (["acme"], "ok"),
                              enrich=lambda jobs, **_: ([{**jobs[0], "postedAt": NOW - 1000}], False), now_ms=NOW)
    assert partial["status"] == "partial" and partial["postingsKept"] == 1

    workday_calls = []

    def collect_workday(targets, *_):
        workday_calls.append(len(targets))
        job = {"company": "Acme", "title": "Engineer", "location": "Shanghai",
               "url": "https://acme.wd5.myworkdayjobs.com/External/job/Shanghai/Engineer_JR-1",
               "postedAt": NOW - 1000}
        if len(workday_calls) == 1:
            return [{"status": "fetched", "provider": "workday", "jobs": [job],
                     "truncated": True, "truncation_kind": "network"}]
        return [{"status": "fetched", "provider": "workday", "jobs": [job,
                {**job, "title": "Engineer II", "url": job["url"] + "-2"}]}]

    workday = discover_global(root / "workday", config, ats=["workday"], collect=collect_workday,
                              load_source=lambda name, cache: (["acme|wd5|External"], "ok"), now_ms=NOW)
    assert workday["status"] == "completed" and workday["postingsKept"] == 2
    assert workday["cappedBoards"] == workday["unreachableBoards"] == 0 and workday_calls == [1, 1]

    workday_calls.clear()
    def lost_workday_retry(targets, *args):
        return collect_workday(targets, *args) if not workday_calls else [None]

    incomplete = discover_global(root / "workday-lost-retry", config, ats=["workday"],
                                 collect=lost_workday_retry,
                                 load_source=lambda name, cache: (["acme|wd5|External"], "ok"), now_ms=NOW)
    assert incomplete["status"] == "partial" and incomplete["postingsKept"] == 1
    assert incomplete["unreachableBoards"] == 1 and workday_calls == [1]

    def collect_auth_truncation(targets, *_):
        job = {"company": "Acme", "title": "Engineer", "location": "Shanghai",
               "url": "https://acme.wd5.myworkdayjobs.com/External/job/Shanghai/Engineer_JR-1",
               "postedAt": NOW - 1000}
        return [{"status": "fetched", "provider": "workday", "jobs": [job],
                 "truncated": True, "truncation_kind": "auth"}]

    auth = discover_global(root / "workday-auth-truncation", config, ats=["workday"],
                           collect=collect_auth_truncation,
                           load_source=lambda name, cache: (["acme|wd5|External"], "ok"), now_ms=NOW)
    assert auth["status"] == "partial" and auth["postingsKept"] == 1
    assert auth["unreachableBoards"] == 1 and auth["cappedBoards"] == 0

    limited_data = root / "limited"
    limited = discover_global(limited_data, config, ats=["greenhouse"], limit=1, collect=collect,
                              load_source=lambda name, cache: (["board0", "board1"], "ok"), now_ms=NOW)
    assert limited["status"] == "partial" and limited["capHit"]
    assert limited["companiesAvailable"] == 2 and limited["companiesScanned"] == 1
    assert not (limited_data / "cache" / "ats-full-checkpoint.json").exists()
    with sqlite3.connect(limited_data / "opportunities.db") as db:
        assert db.execute("SELECT status FROM source_health WHERE source='greenhouse'").fetchone()[0] == "incomplete"

    preview = discover_global(data, config, ats=["greenhouse"], dry_run=True,
                              collect=lambda targets, *_: [{"status": "fetched", "provider": "greenhouse", "jobs": [{
                                  "company": "New", "title": "Engineer", "location": "Shanghai",
                                  "url": "https://job-boards.greenhouse.io/new/jobs/1", "postedAt": NOW - 1000,
                              }]}], load_source=lambda name, cache: (["new"], "ok"), now_ms=NOW)
    assert preview["dry_run"] and not preview["saved"] and preview["postingsKept"] == 1
    with sqlite3.connect(data / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 51
    assert seed_entry({"name": "Seed", "ats": "lever", "ats_id": "seed"})["provider"] == "lever"
    assert seed_entry({"name": "Seed", "slug": "seed"})["careers_url"] == "https://job-boards.greenhouse.io/seed"
    assert seed_entry({"name": "Seed", "url": "https://example.org/?jobs=job-boards.eu.greenhouse.io/seed"})["provider"] == "greenhouse"
    assert seed_entry({"name": "Seed", "url": "https://jobs.ashbyhq.com/seed"})["provider"] == "ashby"
    assert seed_entry({"name": "Seed", "url": "https://example.org"}) is None

    seed_calls = []

    def collect_seed(targets, *_):
        seed_calls.extend(targets)
        return [{"status": "fetched", "jobs": [{"company": "Seed", "title": "Engineer",
                 "location": "Shanghai", "url": "https://jobs.lever.co/seed/job-1",
                 "postedAt": NOW - 1000}]}]

    seed_data = root / "seed"
    seed_result = discover_global(seed_data, config, seeds=["yc"], collect=collect_seed,
                                  load_portfolio=lambda _: [{"name": "Seed", "ats": "lever", "ats_id": "seed"}],
                                  verify=lambda offers: [{"url": offer["url"], "result": "uncertain"} for offer in offers],
                                  liveness=True, md_out=root / "digest", now_ms=NOW)
    assert seed_result["sources"] == [] and seed_result["postingsKept"] == 1
    assert len(seed_calls) == 1 and seed_calls[0]["provider"] == "lever"
    assert (root / "digest" / seed_result["date"]).with_suffix(".md").is_file()
    with sqlite3.connect(seed_data / "opportunities.db") as db:
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 1

    expired = discover_global(root / "expired", config, seeds=["yc"], collect=collect_seed,
                              load_portfolio=lambda _: [{"name": "Seed", "ats": "lever", "ats_id": "seed"}],
                              verify=lambda offers: [{"url": offer["url"], "result": "expired"} for offer in offers],
                              liveness=True, now_ms=NOW)
    assert expired["postingsKept"] == 0
    empty_seed = discover_global(root / "empty-seed", config, seeds=["a16z"],
                                 load_portfolio=lambda _: [], now_ms=NOW)
    assert empty_seed["status"] == "partial" and empty_seed["datasetStatus"] == {"a16z": "empty"}
    partial_seed = discover_global(root / "partial-seed", config, seeds=["yc"], collect=collect_seed,
                                   load_portfolio=lambda _: {"companies": [{"name": "Seed", "ats": "lever", "ats_id": "seed"}],
                                                             "partial": True}, now_ms=NOW)
    assert partial_seed["status"] == "partial" and partial_seed["postingsKept"] == 1
    assert partial_seed["datasetStatus"] == {"yc": "partial"}
    limited_seed_data = root / "limited-seed"
    limited_seed = discover_global(limited_seed_data, config, seeds=["yc"], limit=1, collect=collect_seed,
                                   load_portfolio=lambda _: [{"name": "Seed", "ats": "lever", "ats_id": "seed"},
                                                              {"name": "Second", "ats": "lever", "ats_id": "second"}],
                                   now_ms=NOW)
    assert limited_seed["status"] == "partial" and limited_seed["capHit"]
    assert limited_seed["companiesAvailable"] == 2 and limited_seed["companiesScanned"] == 1
    with sqlite3.connect(limited_seed_data / "opportunities.db") as db:
        assert db.execute("SELECT status FROM source_health WHERE source='yc'").fetchone()[0] == "incomplete"

    seed_companies = [{"name": name, "ats": "lever", "ats_id": name.lower()}
                      for name in ("Failed", "Capped", "Kept")]

    def collect_mixed_seed(targets, *_):
        return [{"status": "error", "error": "board unavailable"},
                {"status": "fetched", "jobs": [{"company": "Capped", "title": "Engineer",
                 "location": "Shanghai", "url": "https://jobs.lever.co/capped/1", "postedAt": NOW - 1000}],
                 "truncated": True, "truncation_kind": "page_cap"},
                {"status": "fetched", "jobs": [{"company": "Kept", "title": "Engineer",
                 "location": "Shanghai", "url": "https://jobs.lever.co/kept/1", "postedAt": NOW - 1000}]}]

    mixed_seed_data = root / "mixed-seed-outcomes"
    mixed_seed = discover_global(mixed_seed_data, config, seeds=["yc"], collect=collect_mixed_seed,
                                 load_portfolio=lambda _: seed_companies, now_ms=NOW)
    assert mixed_seed["status"] == "partial" and mixed_seed["datasetStatus"] == {"yc": "partial"}
    assert mixed_seed["unreachableBoards"] == mixed_seed["cappedBoards"] == 1
    assert mixed_seed["postingsKept"] == 2
    with sqlite3.connect(mixed_seed_data / "opportunities.db") as db:
        assert db.execute("SELECT status FROM source_health WHERE source='yc'").fetchone()[0] == "incomplete"
        assert db.execute("SELECT count(*) FROM opportunities").fetchone()[0] == 2

    partial_batch = discover_global(root / "partial-seed-batch", config, seeds=["yc"],
                                    collect=lambda targets, *_: [collect_mixed_seed(targets)[1], None,
                                                                  collect_mixed_seed(targets)[2]],
                                    load_portfolio=lambda _: seed_companies, now_ms=NOW, verbose=True)
    assert partial_batch["status"] == "partial" and partial_batch["postingsKept"] == 2
    assert partial_batch["unreachableBoards"] == 1
    assert partial_batch["failures"][0]["error"] == "collector timed out"

    failed_batch_data = root / "failed-seed-batch"
    failed_batch = discover_global(failed_batch_data, config, seeds=["yc"],
                                   collect=lambda *_: (_ for _ in ()).throw(RuntimeError("collector exited")),
                                   load_portfolio=lambda _: seed_companies, now_ms=NOW)
    assert failed_batch["status"] == "partial" and failed_batch["datasetStatus"] == {"yc": "partial"}
    assert failed_batch["unreachableBoards"] == len(seed_companies) and failed_batch["postingsKept"] == 0
    with sqlite3.connect(failed_batch_data / "opportunities.db") as db:
        assert db.execute("SELECT status FROM source_health WHERE source='yc'").fetchone()[0] == "incomplete"

    resumed_health_data = root / "resumed-health"
    fail_lever = [True]

    def collect_health(targets, *_):
        if targets[0]["name"] == "lever-board" and fail_lever[0]:
            fail_lever[0] = False
            raise RuntimeError("lever interrupted")
        return [{"status": "fetched", "provider": target["provider"], "jobs": [{
            "company": target["name"], "title": "Engineer", "location": "Shanghai",
            "url": f'https://example.com/jobs/{target["name"]}', "postedAt": NOW - 1000,
        }], "truncated": target["name"] == "greenhouse-board",
            "truncation_kind": "page_cap" if target["name"] == "greenhouse-board" else None}
            for target in targets]

    health_args = {"ats": ["greenhouse", "lever"], "collect": collect_health,
                   "load_source": lambda name, cache: ([f"{name}-board"], "ok")}
    interrupted_health = discover_global(resumed_health_data, config, now_ms=NOW, **health_args)
    assert interrupted_health["stoppedByOutage"]
    health_checkpoint = resumed_health_data / "cache" / "ats-full-checkpoint.json"
    assert json.loads(health_checkpoint.read_text())["source_health"][0]["status"] == "incomplete"
    resumed_health = discover_global(resumed_health_data, config, now_ms=NOW + 10_000, resume=True, **health_args)
    assert resumed_health["status"] == "partial" and not health_checkpoint.exists()
    with sqlite3.connect(resumed_health_data / "opportunities.db") as db:
        assert dict(db.execute("SELECT source,status FROM source_health")) == {
            "greenhouse": "incomplete", "lever": "incomplete"}

    mixed_data = root / "mixed"
    mixed_calls = []

    def collect_mixed(targets, *_):
        mixed_calls.append(targets[0]["name"])
        if targets[0]["name"] == "board50" and mixed_calls.count("board50") == 1:
            raise RuntimeError("directory interrupted")
        if targets[0]["name"] == "Seed":
            return collect_seed(targets, *_)
        return collect(targets, *_)

    mixed_args = {"ats": ["greenhouse"], "seeds": ["yc"], "collect": collect_mixed,
                  "load_source": source,
                  "load_portfolio": lambda _: [{"name": "Seed", "ats": "lever", "ats_id": "seed"}]}
    mixed_first = discover_global(mixed_data, config, now_ms=NOW, **mixed_args)
    assert mixed_first["stoppedByOutage"]
    mixed_checkpoint = json.loads((mixed_data / "cache" / "ats-full-checkpoint.json").read_text())
    assert mixed_checkpoint["current"]["resume_at"] == 50
    assert "yc" in mixed_checkpoint["completed_sources"]
    assert any(item["company"] == "yc" for item in mixed_checkpoint["source_health"])
    mixed_resumed = discover_global(mixed_data, config, now_ms=NOW + 10_000, resume=True, **mixed_args)
    assert mixed_resumed["postingsKept"] == mixed_resumed["companiesAvailable"] == 52
    assert mixed_calls.count("Seed") == 1
    with sqlite3.connect(mixed_data / "opportunities.db") as db:
        assert dict(db.execute("SELECT source,status FROM source_health")) == {
            "greenhouse": "incomplete", "yc": "reachable"}
        assert db.execute("SELECT count(*) FROM source_health").fetchone()[0] == 2

    def failed_boards(targets, _cutoff, _undated, _concurrency, *, resolver):
        return [{"status": "error", "error": "DNS unavailable" if resolver else "board not found",
                 "resolver_failure": resolver} for _ in targets]

    outage_data = root / "resolver-outage"
    outage = discover_global(outage_data, config, ats=["greenhouse"], load_source=source, now_ms=NOW,
                             collect=lambda *args: failed_boards(*args, resolver=True))
    outage_checkpoint = outage_data / "cache" / "ats-full-checkpoint.json"
    assert outage["stoppedByOutage"] and outage["resumable"] and outage["companiesScanned"] == 50
    assert json.loads(outage_checkpoint.read_text())["current"]["resume_at"] == 50
    assert json.loads(outage_checkpoint.read_text())["source_health"][0]["status"] == "network"

    absent_data = root / "absent-boards"
    absent = discover_global(absent_data, config, ats=["greenhouse"], load_source=source, now_ms=NOW,
                             collect=lambda *args: failed_boards(*args, resolver=False))
    assert absent["status"] == "partial" and not absent["stoppedByOutage"]
    assert absent["companiesScanned"] == len(BOARDS) and not (absent_data / "cache" / "ats-full-checkpoint.json").exists()
    with sqlite3.connect(absent_data / "opportunities.db") as db:
        assert db.execute("SELECT status FROM source_health WHERE source='greenhouse'").fetchone()[0] == "incomplete"
print("reverse runner: partial collection, exact resume and idempotent SQLite handoff passed")
