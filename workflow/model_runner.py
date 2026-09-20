"""Run one isolated score-generation or review model process for LangGraph."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def load_legacy_model_adapter():
    """Reuse the proven prompts and Hermes model boundary during score migration."""
    path = ROOT / "scripts" / "hermes-score.py"
    spec = importlib.util.spec_from_file_location("career_ops_score_adapter", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def evaluate(payload: dict) -> dict:
    inputs = payload["inputs"]
    jd = inputs["jd_report"]
    if jd["prescreen"]["status"] == "fail":
        return {
            "outcome": "exclude",
            "artifact": {"type": "exclusion", "reason": jd["prescreen"]["reason"], "evidence": jd["prescreen"].get("evidence", [])},
            "tool_calls": 0,
        }
    adapter = load_legacy_model_adapter()
    key = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    directory = ROOT / "data" / "workflow-drafts" / key
    directory.mkdir(parents=True, exist_ok=True)
    revision = payload["revision"]
    saved_review = directory / "report.md.review.json"
    repairing = revision > 0 or saved_review.exists()
    previous_review = payload.get("previous_review")
    if saved_review.exists():
        previous_review = json.loads(saved_review.read_text())
    if repairing:
        previous = json.loads((directory / "assessment.json").read_text())
        research = {"sources": previous["sources"], "research": previous["research"]}
    else:
        research_inputs = {
            "url": jd["url"], "company": jd["company"], "role": jd["role"],
            "jd": jd["jd"], "date": jd.get("captured_at", "unknown"), "prompt": adapter.RESEARCH,
        }
        research = adapter.call_agent(
            "research", adapter.RESEARCH + json.dumps(research_inputs, ensure_ascii=False), ["web"], directory
        )[0]
    assessment_inputs = {
        "url": jd["url"], "sources": {key: inputs[key] for key in ("cv", "profile", "targeting", "rules")},
        "evidence": jd, "research": research, "prompt": adapter.ASSESS,
    }
    prompt = adapter.ASSESS + json.dumps(assessment_inputs, ensure_ascii=False)
    phase = "assessment"
    if repairing:
        phase = "repair"
        prompt += "\nCorrect only the independent review defects using the frozen research.\n" + json.dumps(
            {"previous": previous, "review": previous_review}, ensure_ascii=False
        )
    assessment = adapter.call_agent(phase, prompt, [], directory)[0]
    assessment.update(research)
    packet = {
        "url": jd["url"], "root": str(ROOT), "directory": str(directory),
        "fingerprint": key, "sources": assessment_inputs["sources"],
    }
    evidence = {
        "company": jd["company"], "role": jd["role"], "complete_jd": True,
        "liveness": "active", "liveness_reason": jd.get("liveness_reason", "JD report verified active"),
        "prescreen": jd["prescreen"], "jd": jd["jd"],
    }
    write_json(directory / "packet.json", packet)
    write_json(directory / "evidence.json", evidence)
    write_json(directory / "assessment.json", assessment)
    for source_id, content in packet["sources"].items():
        (directory / f"{source_id}.txt").write_text(content)
    rendered = subprocess.run(
        ["node", str(ROOT / "score-job.mjs"), "render", str(directory)],
        cwd=ROOT, text=True, capture_output=True, timeout=30,
    )
    if rendered.returncode:
        raise RuntimeError(rendered.stderr.strip())
    result = json.loads(rendered.stdout)
    return {
        "outcome": "score",
        "artifact": {
            "type": "score", "report": result["report"], "report_sha256": result["report_sha256"],
            "draft_directory": str(directory), "liveness_reason": evidence["liveness_reason"],
        },
        "tool_calls": 0 if repairing else 6,
    }


def review(payload: dict) -> dict:
    adapter = load_legacy_model_adapter()
    artifact = payload["artifact"]
    inputs = payload["inputs"]
    if artifact["type"] == "exclusion":
        prompt = (
            "Independently review this exclusion using only the JD report and rule inputs. "
            "Return the standard review JSON. Unknown is not evidence of mismatch.\n"
            + json.dumps(payload, ensure_ascii=False)
        )
        decision, reviewer = adapter.call_agent("review", prompt, [], ROOT / "data" / "workflow-drafts")
        return {**decision, "reviewer": reviewer, "tool_calls": 0}
    directory = Path(artifact["draft_directory"])
    review_inputs = {
        "report": artifact["report"],
        "sources": json.loads((directory / "assessment.json").read_text()).get("sources", []),
        "liveness": artifact["liveness_reason"],
        "jd_report": inputs["jd_report"],
    }
    decision, reviewer = adapter.call_agent(
        "review", adapter.REVIEW + json.dumps(review_inputs, ensure_ascii=False), [], directory
    )
    decision.update({"reviewer": reviewer, "report_sha256": artifact["report_sha256"]})
    report_path = directory / "report.md"
    report_path.write_text(artifact["report"])
    write_json(Path(str(report_path) + ".review.json"), decision)
    checked = subprocess.run(
        ["node", str(ROOT / "scoring-report.mjs"), str(report_path)],
        cwd=ROOT, text=True, capture_output=True, timeout=30,
    )
    if checked.returncode:
        decision["verdict"] = "revise"
        decision["validation_error"] = checked.stdout.strip() or checked.stderr.strip()
    return {**decision, "tool_calls": 0}


def main() -> None:
    payload = json.load(sys.stdin)
    result = evaluate(payload) if sys.argv[1] == "evaluate" else review(payload)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
