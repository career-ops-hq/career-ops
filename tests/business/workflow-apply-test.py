"""Verify apply package HITL, invalidation and cross-process confirmation."""

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from career_ops.db import BusinessStore
from career_ops.input_contracts import validate_resume_payload

PYTHON = ROOT / ".venv" / "bin" / "python"
RUNNER = f"{PYTHON} {ROOT / 'tests' / 'fixtures' / 'workflow-model-runner.py'}"
RESUME_RENDERER = f"{PYTHON} {ROOT / 'tests' / 'fixtures' / 'workflow-resume-renderer.py'}"

try:
    validate_resume_payload({"candidate": {"name": "Jane Doe"}, "summary": "Verified", "projects_start_on_new_page": "true"})
except ValueError as error:
    assert "projects_start_on_new_page" in str(error)
else:
    raise AssertionError("Non-boolean layout instruction was accepted")

with tempfile.TemporaryDirectory(prefix="career-ops-draft-migration-") as temporary:
    database = Path(temporary) / "opportunities.db"
    store = BusinessStore(database)
    task = store.start("legacy-draft", "apply", "{}")
    store.db.execute("ALTER TABLE drafts ADD COLUMN review TEXT NOT NULL DEFAULT '{}'")
    store.db.execute("ALTER TABLE drafts ADD COLUMN approved INTEGER NOT NULL DEFAULT 0")
    store.db.execute(
        "INSERT INTO drafts(task_id,version,input_hash,package_hash,payload) VALUES(?,?,?,?,?)",
        (task["task_id"], 1, store.task(task["task_id"])["input_hash"], "hash", '{"package":{}}'),
    )
    store.close()
    store = BusinessStore(database)
    assert set(store.draft(task["task_id"])) == {"package", "version", "package_hash", "input_hash"}
    store.close()


def call(directory: Path, input_root: Path, *args: str, expected: int = 0,
         extra_env: dict | None = None) -> dict:
    result = subprocess.run(
        [str(PYTHON), "-m", "career_ops", "--directory", str(directory), *args],
        text=True, capture_output=True,
        env={**os.environ, "CAREER_OPS_MODEL_RUNNER": RUNNER, "CAREER_OPS_RESUME_RENDERER": RESUME_RENDERER,
             "CAREER_OPS_INPUT_ROOT": str(input_root), **(extra_env or {})},
    )
    assert result.returncode == expected, (args, result.stdout, result.stderr)
    return json.loads(result.stdout) if result.stdout else {}


def source(path: Path, opportunity: str, jd: str) -> Path:
    path.write_text(json.dumps({
        "schema_version": "scan_input_v1", "opportunity_id": opportunity,
        "url": f"https://example.com/{opportunity}", "company": "Example", "role": "AI Engineer",
        "captured_at": "2026-09-20T04:00:00Z", "liveness": "active", "jd": jd,
    }))
    return path


with tempfile.TemporaryDirectory(prefix="career-ops-apply-") as temporary:
    root = Path(temporary)
    directory = root / "workflow"
    inputs = root / "inputs"
    (inputs / "config").mkdir(parents=True)
    (inputs / "modes").mkdir()
    (inputs.parent / "rules" / "applications").mkdir(parents=True)
    (inputs.parent / "rules" / "shared").mkdir()
    (inputs / "writing-samples").mkdir()
    for market in ("cn", "hk", "remote"):
        (inputs.parent / "rules" / "markets" / market).mkdir(parents=True)
        (inputs.parent / "rules" / "markets" / market / "employment.md").write_text(f"{market} employment rule")
    (inputs / "cv.md").write_text("Verified candidate facts")
    (inputs / "profile.yml").write_text("language:\n  output: zh-CN\n")
    (inputs / "targeting.md").write_text("Target AI roles")
    (inputs.parent / "rules").mkdir(parents=True, exist_ok=True)
    (inputs.parent / "rules" / "scoring.md").write_text("Never invent claims")
    (inputs.parent / "rules" / "shared" / "contract.md").write_text("Candidate claims require evidence")
    (inputs.parent / "rules" / "applications" / "workflow.md").write_text("Prepare resume and application materials; never submit.")
    (inputs / "article-digest.md").write_text("Approved article evidence")
    (inputs / "voice.md").write_text("Direct first-person voice")
    (inputs / "writing-samples" / "sample.md").write_text("Approved writing sample")

    first = source(root / "first.json", "job-1", "Build reviewed AI agents.")
    call(directory, inputs, "start", "scan", "job-1", str(first))
    call(directory, inputs, "start", "score", "job-1", "scan:job-1")
    draft = call(directory, inputs, "start", "apply", "job-1", "score:job-1")
    with sqlite3.connect(directory / "opportunities.db") as connection:
        stored_input = json.loads(connection.execute("SELECT input_payload FROM tasks WHERE task_id=?", (draft["task_id"],)).fetchone()[0])
    assert stored_input["artifact_contract_version"] == 4
    assert stored_input["articles"] == "Approved article evidence"
    assert stored_input["voice"] == "Direct first-person voice"
    assert stored_input["writing_samples"]["writing-samples/sample.md"] == "Approved writing sample"
    assert set(stored_input["market_rules"]) == {"cn", "hk", "remote"}
    assert draft["status"] == "waiting" and draft["reason"] == "user_review"
    assert draft["allowed_actions"] == ["feedback", "confirm", "defer", "cancel"]
    assert "review" not in draft["artifact"]
    assert Path(draft["artifact"]["files"]["resume_payload"]).is_file()
    assert Path(draft["artifact"]["files"]["resume_pdf"]).is_file()
    assert Path(draft["artifact"]["files"]["resume_metadata"]).is_file()
    assert draft["artifact"]["pdf_receipt"]["pages"] == 1
    assert Path(draft["artifact"]["files"]["cover_letter"]).is_file()
    assert "application_answers" not in draft["artifact"]["files"]
    cover_letter = Path(draft["artifact"]["files"]["cover_letter"])
    original_letter = cover_letter.read_text()
    cover_letter.write_text("changed after staging")
    call(directory, inputs, "resume", draft["task_id"], "--decision", "confirm", expected=1)
    assert call(directory, inputs, "show", draft["task_id"])["status"] == "waiting"
    cover_letter.write_text(original_letter)
    with sqlite3.connect(directory / "opportunities.db") as connection:
        original_manifest = connection.execute(
            "SELECT payload FROM drafts WHERE task_id=? ORDER BY version DESC LIMIT 1", (draft["task_id"],)
        ).fetchone()[0]
        missing_letter = json.loads(original_manifest)
        missing_letter["files"].pop("cover_letter")
        missing_letter["file_hashes"].pop("cover_letter")
        connection.execute("UPDATE drafts SET payload=? WHERE task_id=?", (json.dumps(missing_letter), draft["task_id"]))
    call(directory, inputs, "resume", draft["task_id"], "--decision", "confirm", expected=1)
    with sqlite3.connect(directory / "opportunities.db") as connection:
        connection.execute("UPDATE drafts SET payload=? WHERE task_id=?", (original_manifest, draft["task_id"]))
        altered_package = json.loads(original_manifest)
        altered_package["package"]["cover_letter"] = "Unconfirmed replacement letter"
        connection.execute("UPDATE drafts SET payload=? WHERE task_id=?", (json.dumps(altered_package), draft["task_id"]))
    call(directory, inputs, "resume", draft["task_id"], "--decision", "confirm", expected=1)
    with sqlite3.connect(directory / "opportunities.db") as connection:
        connection.execute("UPDATE drafts SET payload=? WHERE task_id=?", (original_manifest, draft["task_id"]))

    deferred = call(directory, inputs, "resume", draft["task_id"], "--decision", "defer")
    assert deferred["status"] == "waiting" and deferred["reason"] == "user_deferred"
    confirmed = call(directory, inputs, "resume", draft["task_id"], "--decision", "confirm")
    assert confirmed["status"] == "completed"
    assert confirmed["artifact"]["outcome"] == "package_confirmed"
    assert call(directory, inputs, "cancel", draft["task_id"])["status"] == "completed"
    cover_letter.write_text("changed after confirmation")
    call(directory, inputs, "resume", draft["task_id"], "--decision", "confirm", expected=1)
    cover_letter.write_text(original_letter)
    assert call(directory, inputs, "resume", draft["task_id"], "--decision", "confirm") == confirmed
    for args in (("--decision", "defer"), ("--feedback", "Retry completed work")):
        call(directory, inputs, "resume", draft["task_id"], *args, expected=1)
        assert call(directory, inputs, "show", draft["task_id"])["status"] == "completed"
    (inputs / "cv.md").write_text("Verified candidate facts changed after confirmation")
    call(directory, inputs, "resume", draft["task_id"], "--decision", "confirm", expected=1)
    (inputs / "cv.md").write_text("Verified candidate facts")

    second = source(root / "second.json", "job-2", "Build agent workflows.")
    call(directory, inputs, "start", "scan", "job-2", str(second))
    call(directory, inputs, "start", "score", "job-2", "scan:job-2")
    second_draft = call(directory, inputs, "start", "apply", "job-2", "score:job-2")
    (inputs / "writing-samples" / "sample.md").write_text("Changed writing sample")
    assert call(directory, inputs, "show", second_draft["task_id"])["reason"] == "input_changed"
    (inputs / "writing-samples" / "sample.md").write_text("Approved writing sample")
    ownership_probe = source(root / "ownership.json", "job-2", "Build changed agent workflows.")
    call(directory, inputs, "start", "scan", "job-2", str(ownership_probe), "--re-evaluate", expected=1)
    assert call(directory, inputs, "show", second_draft["task_id"])["status"] == "waiting"
    revised = call(directory, inputs, "resume", second_draft["task_id"], "--feedback", "Emphasize verified testing work")
    assert revised["status"] == "waiting" and revised["attempt"] == 2
    assert revised["artifact"]["version"] == 2

    (inputs / "cv.md").write_text("Verified candidate facts changed")
    invalid = call(directory, inputs, "show", second_draft["task_id"])
    assert invalid["reason"] == "input_changed"
    rejected = call(directory, inputs, "resume", second_draft["task_id"], "--decision", "confirm", expected=1)
    refreshed = call(directory, inputs, "resume", second_draft["task_id"], "--feedback", "Regenerate for current facts")
    assert refreshed["attempt"] == 3 and refreshed["artifact"]["version"] == 3

    changed_jd = root / "changed-jd.json"
    changed_jd.write_text(json.dumps({
        "schema_version": "jd_report_v1", "opportunity_id": "job-2",
        "url": "https://example.com/job-2", "company": "Example", "role": "AI Engineer",
        "captured_at": "2026-09-21T00:00:00Z", "liveness": "active", "jd": "Build agent workflows and production evaluation.",
        "prescreen": {"status": "pass"},
    }))
    changed = call(directory, inputs, "resume", second_draft["task_id"], "--input", str(changed_jd))
    assert changed["reason"] == "jd_changed" and changed["input_change"]["diff"]
    accepted = call(directory, inputs, "resume", second_draft["task_id"], "--decision", "accept-jd-change")
    assert accepted["status"] == "waiting" and accepted["artifact"]["version"] == 4
    cancelled = call(directory, inputs, "cancel", second_draft["task_id"])
    assert cancelled["status"] == "cancelled"
    assert call(directory, inputs, "cancel", second_draft["task_id"])["status"] == "cancelled"
    for args in (("--decision", "defer"), ("--feedback", "Retry cancelled work"), ("--input", str(changed_jd))):
        call(directory, inputs, "resume", second_draft["task_id"], *args, expected=1)
        assert call(directory, inputs, "show", second_draft["task_id"])["status"] == "cancelled"
    with sqlite3.connect(directory / "opportunities.db") as connection:
        assert connection.execute("SELECT COUNT(*) FROM feedback WHERE task_id=? AND text='Retry cancelled work'",
                                  (second_draft["task_id"],)).fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM events WHERE task_id=? AND type='cancelled'",
                                  (second_draft["task_id"],)).fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM events WHERE task_id=? AND type='cancelled'",
                                  (draft["task_id"],)).fetchone()[0] == 0
    store = BusinessStore(directory / "opportunities.db")
    store.wait(second_draft["task_id"], "must_not_reopen")
    assert store.task(second_draft["task_id"])["status"] == "cancelled"
    count = store.db.execute("SELECT COUNT(*) FROM drafts WHERE task_id=?", (second_draft["task_id"],)).fetchone()[0]
    try:
        store.stage_draft({"task_id": second_draft["task_id"], "input_hash": store.task(second_draft["task_id"])["input_hash"]},
                          {"files": {}})
    except ValueError as error:
        assert "no longer running" in str(error)
    else:
        raise AssertionError("Cancelled apply task staged another draft")
    assert store.db.execute("SELECT COUNT(*) FROM drafts WHERE task_id=?", (second_draft["task_id"],)).fetchone()[0] == count
    store.close()

    third = source(root / "third.json", "job-3", "Build reliable AI agents.")
    call(directory, inputs, "start", "scan", "job-3", str(third))
    call(directory, inputs, "start", "score", "job-3", "scan:job-3")
    crashed = subprocess.run(
        [str(PYTHON), "-m", "career_ops", "--directory", str(directory), "start", "apply", "job-3", "score:job-3", "--crash-at", "publish"],
        text=True, capture_output=True,
        env={**os.environ, "CAREER_OPS_MODEL_RUNNER": RUNNER, "CAREER_OPS_RESUME_RENDERER": RESUME_RENDERER,
             "CAREER_OPS_INPUT_ROOT": str(inputs)},
    )
    assert crashed.returncode == 0
    crashed_task = next(task for task in call(directory, inputs, "list") if task["opportunity_id"] == "job-3" and task["module"] == "apply")
    recovered = call(directory, inputs, "run", crashed_task["task_id"])
    assert recovered["status"] == "waiting" and recovered["reason"] == "user_review"
    budgeted = call(directory, inputs, "resume", crashed_task["task_id"], "--feedback", "force-budget")
    assert budgeted["reason"] == "tool_budget_exhausted"

    fourth = source(root / "fourth.json", "job-4", "Build verifiable AI agents.")
    call(directory, inputs, "start", "scan", "job-4", str(fourth))
    call(directory, inputs, "start", "score", "job-4", "scan:job-4")
    apply_call_log = root / "failed-export-model-calls.txt"
    failed_export = subprocess.run(
        [str(PYTHON), "-m", "career_ops", "--directory", str(directory), "start", "apply", "job-4", "score:job-4"],
        text=True, capture_output=True,
        env={**os.environ, "CAREER_OPS_MODEL_RUNNER": RUNNER, "CAREER_OPS_RESUME_RENDERER": RESUME_RENDERER,
             "CAREER_OPS_INPUT_ROOT": str(inputs), "CAREER_OPS_RESUME_FAIL_ONCE": str(root / "export-failed"),
             "WORKFLOW_TEST_CALL_LOG": str(apply_call_log)},
    )
    assert failed_export.returncode == 1
    export_task = next(task for task in call(directory, inputs, "list") if task["opportunity_id"] == "job-4" and task["module"] == "apply")
    assert export_task["reason"] == "failure:RuntimeError"
    export_recovered = call(directory, inputs, "run", export_task["task_id"],
                            extra_env={"WORKFLOW_TEST_CALL_LOG": str(apply_call_log)})
    assert export_recovered["status"] == "waiting" and export_recovered["reason"] == "user_review"
    assert apply_call_log.read_text().splitlines() == ["apply_evaluate"]
    assert export_recovered["artifact"]["version"] == 1
    assert Path(export_recovered["artifact"]["files"]["resume_pdf"]).is_file()

print("workflow apply: package HITL, invalidation, JD choice and confirmation passed")
