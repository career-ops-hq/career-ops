"""Keep configured discovery checkpoints small and reject changed decision artifacts."""

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from career_ops.discovery.graph import run_discovery_graph


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    body = "role evidence " * 160_000
    calls = []

    def collect(cutoffs):
        calls.append("collect")
        return [{"jobs": [{"description": body}]}], []

    def decide(results, warnings, cutoffs, run_id):
        calls.append("decide")
        return {"description": results[0]["jobs"][0]["description"]}

    def publish(decision, run_id):
        calls.append("publish")
        raise RuntimeError("interrupted before graph checkpoint")

    arguments = dict(resume=False, collect=collect, decide=decide, publish=publish,
                     collector_failure=lambda message, run_id: {"status": "failed", "error": message})
    try:
        run_discovery_graph(root, "same-inputs", {"effective_after": None, "since_ms": None}, **arguments)
    except RuntimeError as error:
        assert str(error) == "interrupted before graph checkpoint"
    else:
        raise AssertionError("Expected publish interruption")
    cache = root / "cache" / "configured-discovery"
    assert (cache / "checkpoints.db").stat().st_size < 200_000
    run_id = json.loads((cache / "latest.json").read_text())["run_id"]
    decision = cache / run_id / "decision.json"
    assert decision.stat().st_size > 1_000_000
    decision.write_text(decision.read_text().replace("role evidence", "changed evidence", 1))
    try:
        run_discovery_graph(root, "same-inputs", {}, **{**arguments, "resume": True})
    except ValueError as error:
        assert "artifact changed" in str(error)
    else:
        raise AssertionError("A changed decision artifact was published")
    assert calls == ["collect", "decide", "publish"]
