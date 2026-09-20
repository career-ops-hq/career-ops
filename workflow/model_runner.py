"""Run one isolated score-generation or review model process for LangGraph."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
DRAFT_ROOT = Path(os.environ["CAREER_OPS_DRAFT_ROOT"]) if "CAREER_OPS_DRAFT_ROOT" in os.environ else ROOT / "data" / "workflow-drafts"


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


def scan_evaluate(payload: dict) -> dict:
    inputs = payload["inputs"]
    source = inputs["source"]
    adapter = load_legacy_model_adapter()
    key = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    directory = DRAFT_ROOT / key
    directory.mkdir(parents=True, exist_ok=True)
    prompt = adapter.EVIDENCE + json.dumps({
        "browser_snapshot": source,
        "cv": inputs["cv"],
        "profile": inputs["profile"],
        "targeting": inputs["targeting"],
        "rules": inputs["rules"],
    }, ensure_ascii=False)
    extracted = adapter.call_agent("scan_evidence", prompt, [], directory)[0]
    evidence = adapter.attach_evidence(extracted, {"text": source["jd"]})
    if evidence["liveness"] == "uncertain":
        return {"waiting_reason": "source_access_unknown", "tool_calls": 1}
    if evidence["complete_jd"] is not True:
        return {"waiting_reason": "core_evidence_missing", "tool_calls": 1}
    evidence["prescreen"]["job"] = {"url": source["url"]}
    evidence_path = directory / "prescreen-input.json"
    write_json(evidence_path, evidence["prescreen"])
    checked = subprocess.run(
        ["node", str(ROOT / "prescreen.mjs"), "--input", str(evidence_path)],
        cwd=ROOT, text=True, capture_output=True, timeout=30,
    )
    if checked.returncode:
        raise RuntimeError(checked.stderr.strip())
    prescreen = json.loads(checked.stdout)
    if evidence["liveness"] == "expired":
        return {
            "outcome": "exclude",
            "artifact": {"type": "exclusion", "reason": evidence["liveness_reason"], "evidence": source["url"]},
            "tool_calls": 1,
        }
    if prescreen["status"] == "fail":
        return {
            "outcome": "exclude",
            "artifact": {
                "type": "exclusion",
                "reason": "; ".join(item["message"] for item in prescreen["discard_reasons"]),
                "evidence": prescreen["discard_reasons"],
            },
            "tool_calls": 1,
        }
    report = {
        "schema_version": "jd_report_v1",
        "opportunity_id": source["opportunity_id"],
        "url": source["url"],
        "company": evidence["company"],
        "role": evidence["role"],
        "jd": source["jd"],
        "captured_at": source["captured_at"],
        "liveness": evidence["liveness"],
        "liveness_reason": evidence["liveness_reason"],
        "prescreen": prescreen,
    }
    return {"outcome": "jd_report", "artifact": report, "tool_calls": 1}


def scan_review(payload: dict) -> dict:
    adapter = load_legacy_model_adapter()
    prompt = (
        "Independently verify that this scan artifact is fully grounded in the immutable source and current rules. "
        "Unknown is not mismatch. Return {verdict:'approve|revise',checks:{grounded:'pass|fail'},defects:[]}.\n"
        + json.dumps(payload, ensure_ascii=False)
    )
    decision, reviewer = adapter.call_agent("scan_review", prompt, [], DRAFT_ROOT)
    if decision.get("verdict") not in ("approve", "revise") or decision.get("checks", {}).get("grounded") not in ("pass", "fail"):
        raise ValueError("Invalid scan review response")
    return {**decision, "reviewer": reviewer, "tool_calls": 0}


def evaluate(payload: dict) -> dict:
    inputs = payload["inputs"]
    jd = inputs["jd_report"]
    if jd["prescreen"]["status"] == "fail":
        reasons = jd["prescreen"].get("discard_reasons", [])
        return {
            "outcome": "exclude",
            "artifact": {
                "type": "exclusion",
                "reason": jd["prescreen"].get("reason") or "; ".join(item["message"] for item in reasons),
                "evidence": jd["prescreen"].get("evidence", reasons),
            },
            "tool_calls": 0,
        }
    key = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    directory = DRAFT_ROOT / key
    directory.mkdir(parents=True, exist_ok=True)
    report_path = directory / "report.md"
    saved_review = directory / "report.md.review.json"
    if not saved_review.exists() and report_path.exists() and (directory / "assessment.json").exists() and (directory / "evidence.json").exists():
        report = report_path.read_text()
        evidence = json.loads((directory / "evidence.json").read_text())
        return {
            "outcome": "score",
            "artifact": {
                "type": "score", "report": report,
                "report_sha256": hashlib.sha256(report.encode()).hexdigest(),
                "draft_directory": str(directory), "liveness_reason": evidence["liveness_reason"],
            },
            "tool_calls": 0,
        }
    adapter = load_legacy_model_adapter()
    revision = payload["revision"]
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
        decision, reviewer = adapter.call_agent("review", prompt, [], DRAFT_ROOT)
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
    phase = sys.argv[1]
    result = {
        "scan_evaluate": scan_evaluate,
        "scan_review": scan_review,
        "evaluate": evaluate,
        "review": review,
    }[phase](payload)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
