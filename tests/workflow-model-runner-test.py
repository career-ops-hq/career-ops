"""Verify resume reuses a rendered score instead of repeating web research."""

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("workflow_model_runner", ROOT / "workflow" / "model_runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

inputs = {
    "jd_report": {"prescreen": {"status": "uncertain"}},
    "cv": "cv", "profile": "profile", "targeting": "targeting", "rules": "rules",
}

with tempfile.TemporaryDirectory(prefix="career-ops-runner-") as temporary:
    runner.DRAFT_ROOT = Path(temporary)
    key = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    directory = runner.DRAFT_ROOT / key
    directory.mkdir()
    (directory / "report.md").write_text("# Completed draft")
    (directory / "assessment.json").write_text("{}")
    (directory / "evidence.json").write_text(json.dumps({"liveness_reason": "Verified active"}))
    runner.load_legacy_model_adapter = lambda: (_ for _ in ()).throw(AssertionError("model must not run"))
    result = runner.evaluate({"inputs": inputs, "revision": 0})
    assert result["artifact"]["report"] == "# Completed draft"
    assert result["tool_calls"] == 0

print("workflow model runner: rendered draft recovery avoids repeated research")
