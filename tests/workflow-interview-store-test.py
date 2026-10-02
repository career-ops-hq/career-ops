"""Check interview draft and confirmation business transactions independently of checkpoints."""

from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from career_ops.interviews.store import InterviewStore, REVIEW_CHECKS
from career_ops.interviews.workflow import task_view


with tempfile.TemporaryDirectory() as temporary:
    path = Path(temporary) / "opportunities.db"
    store = InterviewStore(path)
    task = store.start("7", "bosch-round-1", "prepare", {"context_hash": "real-input-hash"})
    same = store.start("7", "bosch-round-1", "prepare", {"context_hash": "real-input-hash"})
    assert same["task_id"] == task["task_id"]
    task_id, input_hash = task["task_id"], task["input_hash"]
    try:
        store.confirm(task_id, input_hash)
    except ValueError as error:
        assert "not approved" in str(error)
    else:
        raise AssertionError("Unreviewed interview was confirmed")
    first = store.stage(task_id, input_hash, {"content": "draft"}, {"verdict": "revise"})
    assert first["version"] == 1 and store.task(task_id)["waiting_reason"] == "review_budget_exhausted"
    store.feedback(task_id, "Use source-backed experience")
    assert store.feedback_history(task_id) == ["Use source-backed experience"]
    approval = {
        "verdict": "approve",
        "checks": {name: {"status": "pass", "finding": "Checked against sources"} for name in REVIEW_CHECKS},
        "unsupported_claims": [], "required_changes": [],
    }
    second = store.stage(task_id, input_hash, {"content": "source-backed draft"}, approval)
    assert second["version"] == 2 and store.task(task_id)["waiting_reason"] == "user_review"
    try:
        store.confirm(task_id, "changed-source")
    except ValueError as error:
        assert "sources changed" in str(error)
    else:
        raise AssertionError("Stale interview draft was confirmed")
    store.db.execute("UPDATE interview_drafts SET artifact=? WHERE task_id=? AND version=2",
                     ('{"content":"unreviewed replacement"}', task_id))
    try:
        task_view(store, task_id)
    except ValueError as error:
        assert "changed since review" in str(error)
    else:
        raise AssertionError("Altered approved interview draft was shown for user review")
    try:
        store.confirm(task_id, input_hash)
    except ValueError as error:
        assert "changed since review" in str(error)
    else:
        raise AssertionError("Unreviewed interview artifact was confirmed")
    store.db.execute("UPDATE interview_drafts SET artifact=? WHERE task_id=? AND version=2",
                     ('{"content":"source-backed draft"}', task_id))
    artifact = store.confirm(task_id, input_hash)
    assert artifact == {"content": "source-backed draft"}
    assert store.confirm(task_id, input_hash) == artifact
    assert [item["kind"] for item in store.history("7", "bosch-round-1")] == ["prepare"]
    store.db.execute("UPDATE interview_results SET artifact=? WHERE task_id=?",
                     ('{"content":"altered after confirmation"}', task_id))
    for read in (lambda: store.confirm(task_id, input_hash),
                 lambda: store.history("7", "bosch-round-1"),
                 lambda: task_view(store, task_id)):
        try:
            read()
        except ValueError as error:
            assert "changed since confirmation" in str(error)
        else:
            raise AssertionError("Altered confirmed interview artifact was accepted")
    store.db.execute("UPDATE interview_results SET artifact=? WHERE task_id=?",
                     ('{"content":"source-backed draft"}', task_id))
    assert store.history("7", "different-round") == []
    later = store.start("7", "bosch-round-2", "practice", {"context_hash": "real-input-hash"})
    store.stage(later["task_id"], later["input_hash"], {"content": "answer"}, approval)
    store.feedback(later["task_id"], "Correct the answer")
    store.wait(later["task_id"], "failure:RuntimeError")
    try:
        store.confirm(later["task_id"], later["input_hash"])
    except ValueError as error:
        assert "not approved" in str(error)
    else:
        raise AssertionError("A stale approved draft survived user feedback")
    store.close()
print("interview store: versioned review, feedback, stale rejection and confirmation passed")
