"""Verify sourced CV preview, confirmation, idempotency, provenance, and write recovery."""

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path(sys.executable)
CLI = ROOT / "workflow" / "cv_maintenance.py"


def call(data: Path, facts: Path, *args: str, expected: int = 0, env: dict | None = None) -> dict:
    result = subprocess.run(
        [str(PYTHON), str(CLI), "--directory", str(data), "--root", str(facts), *args],
        text=True, capture_output=True, env={**os.environ, **(env or {})},
    )
    assert result.returncode == expected, (args, result.stdout, result.stderr)
    return json.loads(result.stdout) if result.stdout else {}


with tempfile.TemporaryDirectory(prefix="career-ops-cv-") as temporary:
    base = Path(temporary)
    facts, data = base / "facts", base / "data"
    facts.mkdir()
    data.mkdir()
    cv = facts / "cv.md"
    article = facts / "article-digest.md"
    cv.write_text("# CV\n\n## Projects\n")
    proposal = base / "proposal.json"
    verified = {
        "source": "user-stated", "sourceRef": "conversation:2026-09-22", "exactEvidence": "Project: Atlas",
        "targetSection": "Projects", "proposedWording": "- **Atlas** — Documented project.", "dedupKey": "Atlas",
        "provenance": "verified", "provenanceRef": "user-stated:2026-09-22", "claimKinds": [],
        "articleDigest": "## Atlas -- Documented Project\n\nGrounded proof point.",
    }
    proposal.write_text(json.dumps({"proposals": [verified]}))

    preview = call(data, facts, "preview", str(proposal))
    assert preview["status"] == "waiting" and preview["waiting_reason"] == "confirmation_required"
    assert "Atlas" not in cv.read_text() and not article.exists()
    assert preview["preview"]["proposals"][0]["result"]["cv"]["status"] == "added"
    assert preview["preview"]["can_apply"] is True
    call(data, facts, "apply", preview["task_id"], "--confirm", "no", expected=2)
    other_facts = base / "other-facts"
    other_facts.mkdir()
    (other_facts / "cv.md").write_text(cv.read_text())
    call(data, other_facts, "apply", preview["task_id"], "--confirm", "approved", expected=2)

    applied = call(data, facts, "apply", preview["task_id"], "--confirm", "approved")
    assert applied["status"] == "completed"
    assert "Atlas" in cv.read_text() and "Atlas -- Documented Project" in article.read_text()
    assert call(data, facts, "apply", preview["task_id"], "--confirm", "approved")["status"] == "completed"
    database = sqlite3.connect(data / "cv-maintenance.db")
    assert database.execute("SELECT count(*) FROM cv_confirmations WHERE task_id=?", (preview["task_id"],)).fetchone()[0] == 1
    database.close()

    duplicate = call(data, facts, "preview", str(proposal))
    assert duplicate["preview"]["proposals"][0]["result"]["cv"]["status"] == "duplicate"
    assert call(data, facts, "apply", duplicate["task_id"], "--confirm", "approved")["status"] == "completed"

    invalid = {**verified, "dedupKey": "Unsafe", "proposedWording": "- **Unsafe** — Built production systems.", "claimKinds": []}
    proposal.write_text(json.dumps(invalid))
    call(data, facts, "preview", str(proposal), expected=2)

    proposal.write_text(json.dumps({**verified, "dedupKey": "Bad article", "articleDigest": {"text": "not markdown"}}))
    call(data, facts, "preview", str(proposal), expected=2)

    unverified = {**verified, "source": "external-discovery", "sourceRef": "https://example.com", "dedupKey": "Lead", "proposedWording": "- **Lead** — Community note.", "provenance": "unverified", "provenanceRef": "https://example.com", "articleDigest": None}
    proposal.write_text(json.dumps(unverified))
    uncertain = call(data, facts, "preview", str(proposal))
    assert uncertain["preview"]["can_apply"] is False
    call(data, facts, "apply", uncertain["task_id"], "--confirm", "approved", expected=2)

    proposal.write_text(json.dumps({**verified, "dedupKey": "Changed", "proposedWording": "- **Changed** — Grounded."}))
    stale = call(data, facts, "preview", str(proposal))
    cv.write_text(cv.read_text() + "\nExternal edit.\n")
    call(data, facts, "apply", stale["task_id"], "--confirm", "approved", expected=2)

    proposal.write_text(json.dumps({**verified, "dedupKey": "Rollback", "proposedWording": "- **Rollback** — Grounded.", "articleDigest": "## Rollback -- Proof\n\nGrounded proof point."}))
    rollback = call(data, facts, "preview", str(proposal))
    before_cv, before_article = cv.read_text(), article.read_text()
    call(data, facts, "apply", rollback["task_id"], "--confirm", "approved", expected=2, env={"CAREER_OPS_CV_CRASH_AFTER_FIRST_WRITE": "1"})
    assert cv.read_text() == before_cv and article.read_text() == before_article
    assert call(data, facts, "show", rollback["task_id"])["status"] == "waiting"

    proposal.write_text(json.dumps({**verified, "dedupKey": "Reconcile", "proposedWording": "- **Reconcile** — Grounded.", "articleDigest": None}))
    reconcile = call(data, facts, "preview", str(proposal))
    call(data, facts, "apply", reconcile["task_id"], "--confirm", "approved", expected=86, env={"CAREER_OPS_CV_CRASH_AFTER_WRITE": "1"})
    assert "Reconcile" in cv.read_text() and call(data, facts, "show", reconcile["task_id"])["status"] == "waiting"
    assert call(data, facts, "apply", reconcile["task_id"], "--confirm", "approved")["status"] == "completed"

    proposal.write_text(json.dumps({**verified, "dedupKey": "Resume", "proposedWording": "- **Resume** — Grounded.", "articleDigest": None}))
    call(data, facts, "preview", str(proposal), expected=86, env={"CAREER_OPS_CV_CRASH_AT_PERSIST": "1"})
    database = sqlite3.connect(data / "cv-maintenance.db")
    resumable = database.execute("SELECT task_id FROM cv_tasks WHERE status='running' ORDER BY created_at DESC, rowid DESC LIMIT 1").fetchone()[0]
    database.close()
    resumed = call(data, facts, "resume", resumable)
    assert resumed["status"] == "waiting" and "Resume" in resumed["preview"]["diff"]["cv"]
    assert (data / "cv-checkpoints.db").is_file()

print("workflow CV maintenance: provenance, preview, confirmation, idempotency and rollback passed")
