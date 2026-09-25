"""Verify cross-process grounded communication drafts and stale-input recovery."""

import json
import fcntl
import hashlib
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow import communications
from workflow.communications import review_node


PYTHON = Path(sys.executable)
MODEL_RUNNER = f"{PYTHON} {ROOT / 'tests/fixtures/workflow-model-runner.py'}"
COMMUNICATION_RUNNER = f"{PYTHON} {ROOT / 'tests/fixtures/workflow-communications-runner.py'}"


def call(directory: Path, inputs: Path, module: str, *args: str, expected: int = 0, extra: dict | None = None) -> dict:
    command = ([str(PYTHON), "-m", "workflow.career_ops"] if module == "workflow"
               else [str(PYTHON), "-m", "workflow.communications"])
    result = subprocess.run(command + ["--directory", str(directory), *args], cwd=ROOT, text=True, capture_output=True,
                            env={**os.environ, "PYTHONPATH": str(ROOT), "CAREER_OPS_INPUT_ROOT": str(inputs),
                                 "CAREER_OPS_MODEL_RUNNER": MODEL_RUNNER,
                                 "CAREER_OPS_COMMUNICATIONS_RUNNER": COMMUNICATION_RUNNER, **(extra or {})})
    assert result.returncode == expected, (args, result.stdout, result.stderr)
    return json.loads(result.stdout) if result.stdout else {}


with tempfile.TemporaryDirectory(prefix="career-ops-communications-") as temporary:
    root = Path(temporary)
    inputs = root / "inputs"
    directory = root / "data"
    for folder in ("config", "modes", "prompts/applications", "prompts/shared", "markets/cn", "markets/hk", "markets/remote", "data", "writing-samples"):
        (inputs / folder).mkdir(parents=True, exist_ok=True)
    (inputs / "cv.md").write_text("Verified candidate facts")
    (inputs / "config/profile.yml").write_text("language:\n  output: en\noutreach:\n  greeting_max_chars: 150\n")
    (inputs / "modes/_profile.md").write_text("AI engineering roles")
    (inputs / "modes/_custom.md").write_text("Ground all claims")
    (inputs / "article-digest.md").write_text("Optional factual article evidence")
    (inputs / "writing-samples/sample.md").write_text("Optional approved writing style")
    (inputs / "prompts/applications/workflow.md").write_text("Draft only; never send")
    (inputs / "prompts/shared/contract.md").write_text("Use candidate facts only")
    for market in ("cn", "hk", "remote"):
        (inputs / "markets" / market / "employment.md").write_text("Do not assume work authorization")
    directory.mkdir()
    with sqlite3.connect(directory / "opportunities.db") as db:
        db.execute("CREATE TABLE opportunities(id INTEGER PRIMARY KEY,url TEXT,company TEXT,role TEXT,source TEXT,state TEXT,application_state TEXT)")
        db.execute("INSERT INTO opportunities VALUES(1,'https://example.com/1','Acme','AI Engineer','official','evaluated','none')")
        db.execute("CREATE TABLE source_evidence(id INTEGER PRIMARY KEY,opportunity_id INTEGER,source TEXT,payload TEXT)")
        db.execute("INSERT INTO source_evidence(opportunity_id,source,payload) VALUES(1,'official',?)", (json.dumps({"description": "JD evidence"}),))
        db.execute("CREATE TABLE artifacts(id INTEGER PRIMARY KEY,opportunity_id INTEGER,kind TEXT,path TEXT,sha256 TEXT)")
        db.execute("INSERT INTO artifacts(opportunity_id,kind,path,sha256) VALUES(1,'report','reports/test.md','hash')")
    source = root / "job.json"
    source.write_text(json.dumps({
        "schema_version": "scan_input_v1", "opportunity_id": "1", "url": "https://example.com/1",
        "company": "Acme", "role": "AI Engineer", "captured_at": "2026-09-24T00:00:00Z",
        "liveness": "active", "jd": "Build AI agents with evidence controls.",
    }))
    call(directory, inputs, "workflow", "start", "scan", "1", str(source))
    call(directory, inputs, "workflow", "start", "score", "1", "scan:1")
    with sqlite3.connect(directory / "opportunities.db") as db:
        for module in ("scan", "score"):
            original = db.execute("SELECT payload FROM results WHERE opportunity_id='1' AND module=?", (module,)).fetchone()[0]
            invalid = json.loads(original)
            invalid["review"] = {"verdict": "approve", "checks": {"grounded": "fail"}}
            db.execute("UPDATE results SET payload=? WHERE opportunity_id='1' AND module=?", (json.dumps(invalid), module))
            db.commit()
            call(directory, inputs, "communications", "draft", "1", expected=1)
            db.execute("UPDATE results SET payload=? WHERE opportunity_id='1' AND module=?", (original, module))
            db.commit()
    log = root / "calls.log"
    extra = {"COMMUNICATION_TEST_CALL_LOG": str(log), "COMMUNICATION_TEST_REPAIR_MARKER": str(root / "repair.marker"),
             "COMMUNICATION_TEST_REQUIRE_COMPLETE_REVIEW_CONTEXT": "1"}
    draft = call(directory, inputs, "communications", "draft", "1", extra=extra)
    assert draft["review"]["verdict"] == "approve"
    assert "AI Engineer" in draft["draft"]["email"]["subject"]
    assert len(draft["draft"]["outreach"]["message"]) <= 150
    statement = "I led the documented internal training workshop."
    stated = call(directory, inputs, "communications", "draft", "1", "--statement", statement)
    assert stated["input_hash"] != draft["input_hash"]
    assert call(directory, inputs, "communications", "show", "1", "--statement", statement)["draft"] == stated["draft"]
    statement_draft = {
        "email": {"subject": "Application", "body": statement}, "outreach": {"message": "Hello"},
        "claims": [{"claim": statement, "source": "user_statement", "quote": statement}],
    }
    communications.validate_draft({"greeting_max_chars": 150, "candidate_sources": {"user_statement": statement}}, statement_draft)
    try:
        communications.validate_draft({"greeting_max_chars": 150, "candidate_sources": {}}, statement_draft)
    except ValueError as error:
        assert "candidate-source evidence" in str(error)
    else:
        raise AssertionError("A past user statement leaked into a later draft")
    assert call(directory, inputs, "communications", "draft", "1", extra=extra)["reused"] is True
    locks = directory / ".locks"
    locks.mkdir(exist_ok=True)
    with (locks / f"communications-{hashlib.sha256(b'1').hexdigest()}.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        call(directory, inputs, "communications", "draft", "1", expected=1)
    assert log.read_text().splitlines() == ["draft", "draft", "review"]
    assert call(directory, inputs, "communications", "show", "1")["draft"] == draft["draft"]
    with sqlite3.connect(directory / "opportunities.db") as db:
        original = db.execute("SELECT draft FROM communication_drafts WHERE opportunity_id='1' AND input_hash=?",
                              (draft["input_hash"],)).fetchone()[0]
        altered = json.loads(original)
        altered["email"]["body"] = "I have ten years of production AI Agent experience."
        db.execute("UPDATE communication_drafts SET draft=? WHERE opportunity_id='1' AND input_hash=?",
                   (json.dumps(altered), draft["input_hash"]))
    call(directory, inputs, "communications", "show", "1", expected=1)
    call(directory, inputs, "communications", "draft", "1", expected=1, extra=extra)
    with sqlite3.connect(directory / "opportunities.db") as db:
        db.execute("UPDATE communication_drafts SET draft=? WHERE opportunity_id='1' AND input_hash=?",
                   (original, draft["input_hash"]))
    with sqlite3.connect(directory / "opportunities.db") as db:
        db.execute("DELETE FROM communication_drafts")
    assert call(directory, inputs, "communications", "draft", "1",
                extra={"COMMUNICATION_TEST_BAD_CLAIM": "1"})["draft"] == draft["draft"]
    for defect in ("BAD_CLAIM", "JOB_AS_CANDIDATE", "LONG_GREETING", "FALSE_ATTACHMENT", "OUTREACH_ATTACHMENT"):
        (inputs / "prompts/applications/workflow.md").write_text(f"Draft only; never send; {defect}")
        call(directory, inputs, "communications", "draft", "1", expected=1,
             extra={f"COMMUNICATION_TEST_{defect}": "1"})
    (inputs / "prompts/applications/workflow.md").write_text("Draft only; correct independent review defects")
    correction_log = root / "correction.log"
    corrected = call(directory, inputs, "communications", "draft", "1", extra={
        "COMMUNICATION_TEST_REVIEW_REVISE_ONCE": str(root / "review-revise.marker"),
        "COMMUNICATION_TEST_CALL_LOG": str(correction_log),
    })
    assert corrected["review"]["verdict"] == "approve"
    assert correction_log.read_text().splitlines() == ["draft", "review", "draft", "review"]
    (inputs / "prompts/applications/workflow.md").write_text("Draft only; never send; review failure")
    recovery_log = root / "recovery.log"
    call(directory, inputs, "communications", "draft", "1", expected=1,
         extra={"COMMUNICATION_TEST_REVIEW_CRASH_ONCE": str(root / "review-crash.marker"),
                "COMMUNICATION_TEST_CALL_LOG": str(recovery_log)})
    assert call(directory, inputs, "communications", "show", "1")["draft"] is None
    assert call(directory, inputs, "communications", "draft", "1",
                extra={"COMMUNICATION_TEST_CALL_LOG": str(recovery_log)})["review"]["verdict"] == "approve"
    assert recovery_log.read_text().splitlines() == ["draft", "review", "review"]
    (inputs / "prompts/applications/workflow.md").write_text("Draft only; never send; revised policy")
    budget_log = root / "budget.log"
    for _ in range(4):
        call(directory, inputs, "communications", "draft", "1", expected=1,
             extra={"COMMUNICATION_TEST_REVIEW_FAIL": "1", "COMMUNICATION_TEST_CALL_LOG": str(budget_log)})
    assert budget_log.read_text().splitlines() == ["draft", "review"] * 3
    with sqlite3.connect(directory / "opportunities.db") as db:
        db.execute("UPDATE source_evidence SET payload=? WHERE opportunity_id=1", (json.dumps({"description": "Updated official evidence"}),))
    assert call(directory, inputs, "communications", "show", "1")["draft"] is None
    (inputs / "prompts/applications/workflow.md").write_text("Draft only; latest revised policy")
    call(directory, inputs, "communications", "draft", "1", expected=1,
         extra={"COMMUNICATION_TEST_MUTATE_DB": str(directory / "opportunities.db")})
    assert call(directory, inputs, "communications", "show", "1")["draft"] is None
    (inputs / "cv.md").write_text("Verified candidate facts changed")
    call(directory, inputs, "communications", "draft", "1", expected=1)
    assert log.read_text().splitlines() == ["draft", "draft", "review"]

for defect in ({"authorship_scope": "fail"}, {"unlisted_claims": ["Unlisted ownership"]}):
    decision = {"verdict": "approve", "grounded": "pass", "policy": "pass",
                "authorship_scope": "pass", "unlisted_claims": [], "reason": "Checked"}
    with patch("workflow.communications.model_call", return_value={**decision, **defect}):
        try:
            review_node({"context": {}, "draft": {}})
        except ValueError:
            pass
        else:
            raise AssertionError(f"Invalid communication review accepted: {defect}")

contact_context = {"greeting_max_chars": 150, "candidate_sources": {"cv": "me@example.com +86 177 9591 5018"}}
contact_draft = {"email": {"subject": "Application", "body": "me@example.com +86 177 9591 5018"},
                 "outreach": {"message": "Hello"}, "claims": []}
for quote in (None, "me@example.com"):
    if quote:
        contact_draft["claims"].append({"claim": quote, "source": "cv", "quote": quote})
    try:
        communications.validate_draft(contact_context, contact_draft)
    except ValueError as error:
        assert "contact detail" in str(error)
    else:
        raise AssertionError("Unlisted contact detail accepted")
contact_draft["claims"].append({"claim": "phone", "source": "cv", "quote": "+86 177 9591 5018"})
communications.validate_draft(contact_context, contact_draft)

identity_context = {"greeting_max_chars": 150, "job": {"role": "Senior Software Developer"},
                    "candidate_sources": {"cv": "# Jiaming Zhang | 张家铭\nJiaming Zhang"}}
identity_draft = {"email": {"subject": "Senior Software Developer", "body": "我是张佳明（Jiaming Zhang）。"},
                  "outreach": {"message": "应聘 Senior Software Developer"},
                  "claims": [{"claim": "name", "source": "cv", "quote": "Jiaming Zhang"}]}
try:
    communications.validate_draft(identity_context, identity_draft)
except ValueError as error:
    assert "Chinese candidate name" in str(error)
else:
    raise AssertionError("Unsupported Chinese candidate name accepted")
identity_draft["email"]["body"] = "我是张家铭（Jiaming Zhang）。"
identity_draft["outreach"]["message"] = "应聘 Senior AI Agent Developer"
try:
    communications.validate_draft(identity_context, identity_draft)
except ValueError as error:
    assert "canonical job role" in str(error)
else:
    raise AssertionError("Renamed job role accepted")
identity_draft["outreach"]["message"] = "应聘 Senior Software Developer"
communications.validate_draft(identity_context, identity_draft)

with tempfile.TemporaryDirectory(prefix="career-ops-communications-recovery-") as temporary:
    directory = Path(temporary)
    context = {"greeting_max_chars": 150, "candidate_sources": {"cv": "Built a Python service."}}
    draft = {"email": {"subject": "AI Engineer", "body": "Built a Python service."},
             "outreach": {"message": "Built a Python service."},
             "claims": [{"claim": "Built a Python service", "source": "cv", "quote": "Built a Python service."}]}
    approval = {"verdict": "approve", "grounded": "pass", "policy": "pass",
                "authorship_scope": "pass", "unlisted_claims": [], "reason": "Source checked"}
    calls = []
    original_connection = communications.store_connection
    fail_commit = [True]

    class FaultConnection:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, statement, parameters=()):
            if fail_commit[0] and statement.startswith("INSERT OR IGNORE INTO communication_drafts"):
                fail_commit[0] = False
                raise sqlite3.OperationalError("simulated business commit failure")
            return self.connection.execute(statement, parameters)

        def close(self):
            self.connection.close()

    def fake_model(phase, payload):
        calls.append(phase)
        return draft if phase == "draft" else approval

    with patch.object(communications, "source_context", return_value=context), \
         patch.object(communications, "model_call", side_effect=fake_model), \
         patch.object(communications, "store_connection", side_effect=lambda path: FaultConnection(original_connection(path))):
        try:
            communications.prepare(directory, "1")
        except sqlite3.OperationalError as error:
            assert "business commit failure" in str(error)
        else:
            raise AssertionError("Expected failure after review checkpoint")
        recovered = communications.prepare(directory, "1")
        assert recovered["review"] == approval and calls == ["draft", "review"]

print("workflow communications: grounded draft, review and idempotency passed")
