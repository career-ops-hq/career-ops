"""Run one isolated score-generation or review model process for LangGraph."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys

from workflow.prescreen import evaluate as evaluate_prescreen
from workflow.report import render_report

ROOT = Path(__file__).resolve().parents[1]
DRAFT_ROOT = Path(os.environ["CAREER_OPS_DRAFT_ROOT"]) if "CAREER_OPS_DRAFT_ROOT" in os.environ else ROOT / "data" / "workflow-drafts"


from workflow import model_adapter


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def normalize_resume_payload(resume: dict) -> dict:
    """Repair the model's common contact-field flattening without changing content."""
    if "candidate" not in resume and resume.get("name"):
        fields = ("name", "email", "phone", "location", "linkedin", "github", "portfolio")
        resume["candidate"] = {key: resume.pop(key) for key in fields if key in resume}
    return resume


def scan_evaluate(payload: dict) -> dict:
    inputs = payload["inputs"]
    source = inputs["source"]
    adapter = model_adapter
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
    prescreen = evaluate_prescreen(evidence["prescreen"])
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
    adapter = model_adapter
    prompt = (
        "Independently verify that this scan artifact is fully grounded in the immutable source and current rules. "
        "Unknown is not mismatch. Return {verdict:'approve|revise',checks:{grounded:'pass|fail'},defects:[]}.\n"
        + json.dumps(payload, ensure_ascii=False)
    )
    decision, reviewer = adapter.call_agent("scan_review", prompt, [], DRAFT_ROOT)
    if decision.get("verdict") not in ("approve", "revise") or decision.get("checks", {}).get("grounded") not in ("pass", "fail"):
        raise ValueError("Invalid scan review response")
    return {**decision, "reviewer": reviewer, "tool_calls": 0}


def apply_evaluate(payload: dict) -> dict:
    adapter = model_adapter
    prompt = """Prepare one application package from only the supplied candidate facts, reviewed JD, score report, rules, requirements and user feedback.
Return JSON with exactly these package fields:
- resume_payload: exact input for reactive-resume.mjs. candidate has name/email/phone/location and optional linkedin/github/portfolio {url,display}; headline and summary are strings; competencies is a string array; experience entries use {company,role,location,dates,bullets:string[]}; projects use {name,url,tech,badge,bullets:string[]}; education uses {org,title,year,description}; certifications and awards use {org,title,year}; skills use {category,items:string[]}. Preserve facts; tailor experience through evidence-backed selection, ordering or rewriting. Never use points/institution/degree keys. Do not invent or upgrade prototypes.
- changes: Markdown listing every material CV change and its source evidence.
- cover_letter: 250-300 words in the JD language. Address the company hiring team unless a named person is supplied. Open with the role and strongest evidence-backed match; map 3 concrete achievements to the role; explain why this company using only supplied evidence; close directly. Use active first-person language, no clichés, em dashes, empty praise, or invented company facts.
- upskill: a targeted interview-preparation plan derived from explicit JD gaps. Include a priority/type/source heatmap, themed learning entries with realistic hours, what to study, what the candidate can skip, a concrete practice artifact, and a dependency-aware study order with total hours. Do not invent courses, URLs, authors, or claims.
- interview_prep: grounded stories, risks and preparation topics.
- questions: questions for the employer, especially unresolved hard conditions.
Write user-facing material in the configured output language. Never submit, send, contact anyone, or modify a base resume. No prose outside JSON.
"""
    if payload.get("previous_artifact"):
        prompt += "Revise the prior package only for the supplied feedback and independent review defects.\n"
    decision, session = adapter.call_agent(
        "apply_evaluate",
        prompt + json.dumps(payload, ensure_ascii=False),
        [],
        DRAFT_ROOT,
    )
    required = {
        "resume_payload", "changes", "cover_letter", "upskill",
        "interview_prep", "questions",
    }
    missing = sorted(required - decision.keys())
    if "resume_payload" in decision:
        normalize_resume_payload(decision["resume_payload"])
    if missing or not decision.get("resume_payload", {}).get("candidate", {}).get("name"):
        raise ValueError("Invalid application package: " + ", ".join(missing or ["resume candidate name"]))
    resume = decision["resume_payload"]
    if not isinstance(resume.get("summary"), str):
        raise ValueError("resume_payload summary is required")
    if any(not all(key in item for key in ("company", "role", "dates", "bullets")) or not isinstance(item["bullets"], list) for item in resume.get("experience", [])):
        raise ValueError("Invalid resume experience schema")
    if any(not all(key in item for key in ("org", "title", "year")) for item in resume.get("education", [])):
        raise ValueError("Invalid resume education schema")
    if any("name" not in item or not isinstance(item.get("bullets", []), list) for item in resume.get("projects", [])):
        raise ValueError("Invalid resume project schema")
    if any("category" not in item or "items" not in item for item in resume.get("skills", [])):
        raise ValueError("Invalid resume skills schema")
    return {"outcome": "package", "artifact": decision, "reviewer": session, "tool_calls": 1}


def apply_review(payload: dict) -> dict:
    adapter = model_adapter
    prompt = """Independently review the application package against all frozen inputs. Do not trust the drafter.
Return {schema:'career-ops/application-review',schema_version:1,verdict:'approve|revise|blocked',checks:[...],unsupported_claims:[],required_changes:[]}.
checks must contain exactly source-grounding, role-alignment, cv-materiality, employer-questions, sensitive-fields and artifact-consistency; each is {id,status:'pass|fail|uncertain',finding}. Approve only when every check passes and both issue arrays are empty. Unknown employer facts must stay unknown. Never submit or send.
The prohibited artifact is application-form Q&A or drafted employer-form answers. interview_prep is a required preparation plan, and questions is the required list of questions the candidate should ask the employer; neither is application-form Q&A and both must remain.
"""
    decision, reviewer = adapter.call_agent(
        "apply_review", prompt + json.dumps(payload, ensure_ascii=False), [], DRAFT_ROOT
    )
    required_checks = {
        "source-grounding", "role-alignment", "cv-materiality",
        "employer-questions", "sensitive-fields", "artifact-consistency",
    }
    checks = decision.get("checks", [])
    valid = (
        decision.get("schema") == "career-ops/application-review"
        and decision.get("schema_version") == 1
        and decision.get("verdict") in ("approve", "revise", "blocked")
        and {item.get("id") for item in checks} == required_checks
        and all(item.get("status") in ("pass", "fail", "uncertain") and item.get("finding") for item in checks)
        and isinstance(decision.get("unsupported_claims"), list)
        and isinstance(decision.get("required_changes"), list)
    )
    if not valid or decision["verdict"] == "approve" and (
        any(item["status"] != "pass" for item in checks)
        or decision["unsupported_claims"] or decision["required_changes"]
    ):
        raise ValueError("Invalid application review response")
    return {**decision, "reviewer": reviewer, "tool_calls": 1}


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
    adapter = model_adapter
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
    result = render_report(packet, evidence, assessment)
    return {
        "outcome": "score",
        "artifact": {
            "type": "score", "report": result["report"], "report_sha256": result["report_sha256"],
            "draft_directory": str(directory), "liveness_reason": evidence["liveness_reason"],
        },
        "tool_calls": 0 if repairing else 6,
    }


def review(payload: dict) -> dict:
    adapter = model_adapter
    artifact = payload["artifact"]
    inputs = payload["inputs"]
    if artifact["type"] == "score" and hashlib.sha256(artifact["report"].encode()).hexdigest() != artifact["report_sha256"]:
        raise ValueError("Score report hash mismatch")
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
    return {**decision, "tool_calls": 0}


def main() -> None:
    payload = json.load(sys.stdin)
    phase = sys.argv[1]
    result = {
        "scan_evaluate": scan_evaluate,
        "scan_review": scan_review,
        "apply_evaluate": apply_evaluate,
        "apply_review": apply_review,
        "evaluate": evaluate,
        "review": review,
    }[phase](payload)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
