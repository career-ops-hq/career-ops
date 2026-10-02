"""Exercise ID-based evaluation, material preparation and interview analysis on isolated facts."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from career_ops.discovery.store import DiscoveryStore

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    data, inputs = root / "data", root / "inputs"
    data.mkdir()
    inputs.mkdir()
    for name, value in {"cv.md": "# Skills\nPython\n\nVerified candidate facts", "profile.yml": "language:\n  output: zh-CN\n", "targeting.md": "AI roles"}.items():
        (inputs / name).write_text(value)
    for name in ["scoring.md", "shared/contract.md", "applications/workflow.md", "markets/cn/employment.md", "markets/hk/employment.md", "markets/remote/employment.md"]:
        path = root / "rules" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("Use sourced facts only.")
    env = {**os.environ, "CAREER_OPS_INPUT_ROOT": str(inputs),
           "CAREER_OPS_MODEL_RUNNER": f"{sys.executable} {ROOT / 'tests/fixtures/workflow-model-runner.py'}",
           "CAREER_OPS_RESUME_RENDERER": f"{sys.executable} {ROOT / 'tests/fixtures/workflow-resume-renderer.py'}"}
    jd = "Build reviewed AI agents as an employee in Shanghai.\n## Requirements\n- Python and Rust"
    url = "https://example.com/jobs/1"
    store = DiscoveryStore(data / "opportunities.db")
    store.ingest({"url": url, "company": "Example", "title": "AI Engineer", "description": jd,
                  "_capture": {"method": "official_job_page", "status": 200, "url": url,
                               "content_hash": hashlib.sha256(jd.encode()).hexdigest(),
                               "retrieved_at": datetime.now(timezone.utc).isoformat()}}, "fixture")
    store.close()

    def run(*args, expected=0):
        result = subprocess.run([sys.executable, "-B", "-m", "career_ops", "--directory", str(data), *args],
                                cwd=ROOT, env=env, text=True, capture_output=True)
        assert result.returncode == expected, (args, result.stdout, result.stderr)
        return json.loads(result.stdout) if result.stdout and expected == 0 else result.stderr

    assert run("list")[0]["id"] == 1
    evaluated = run("evaluate", "1")
    assert evaluated["module"] == "score" and evaluated["status"] == "completed"
    assert run("evaluate", "1")["task_id"] == evaluated["task_id"]
    context = run("show", "1")
    assert context["opportunity"]["company"] == "Example" and context["results"]["scan"]["artifact"]["jd"] == jd
    prepared = run("apply", "prepare", "1")
    assert prepared["status"] == "waiting" and prepared["reason"] == "user_review"
    assert set(prepared["allowed_actions"]) == {"feedback", "confirm", "defer", "cancel"}
    plan = run("interview", "preparation-plan", "1")
    assert plan["role"] == {"company": "Example", "title": "AI Engineer"}
    gap = run("interview", "jd-skill-gap", "1")
    assert "Python" in gap["existing"] and "Rust" in gap["gap"]
    assert "require --view followups" in run("list", "--overdue-only", expected=2)
    assert "put global immediately" in run("discover", "--dry-run", "global", expected=2)
    assert "not allowed with argument" in run("system", "resolve-company", "Example", "--write", "--dry-run", expected=2)
    assert "requires --confirmed" in run("apply", "record", "submit", "1", "--idempotency-key", "unconfirmed", expected=1)
print("opportunity CLI: derived inputs, stable tasks, review boundary and safe preview passed")
