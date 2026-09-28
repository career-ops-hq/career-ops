"""Run isolated scan, score, and application generation for LangGraph."""

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
    """Unwrap common model groupings without changing resume content."""
    sections = resume.get("sections")
    if (set(resume) == {"basics", "sections"} and isinstance(resume.get("basics"), dict) and isinstance(sections, dict)
            and isinstance(sections.get("summary"), dict)):
        basics = resume.pop("basics")
        resume.pop("sections")
        summary = sections.pop("summary")
        resume.update(sections)
        resume["candidate"] = basics
        resume["headline"] = summary.get("headline")
        resume["summary"] = summary.get("summary")
    if "candidate" not in resume and resume.get("name"):
        fields = ("name", "email", "phone", "location", "linkedin", "github", "portfolio")
        resume["candidate"] = {key: resume.pop(key) for key in fields if key in resume}
    return resume


def application_package_error(decision: dict) -> str | None:
    """Return the first strict package-contract defect, if any."""
    if not isinstance(decision, dict):
        return "package must be an object"
    required = {
        "resume_payload", "changes", "cover_letter", "upskill",
        "interview_prep", "questions",
    }
    missing = sorted(required - decision.keys())
    if missing:
        return ", ".join(missing)
    for key in sorted(required - {"resume_payload"}):
        if not isinstance(decision[key], str) or not decision[key].strip():
            return f"{key} must be a nonempty Markdown string"
    if not isinstance(decision["resume_payload"], dict):
        return "resume_payload must be an object"
    if "resume_payload" in decision:
        normalize_resume_payload(decision["resume_payload"])
    if (not isinstance(decision["resume_payload"].get("candidate"), dict)
            or not decision["resume_payload"]["candidate"].get("name")):
        return "resume candidate name"
    resume = decision["resume_payload"]
    if not isinstance(resume.get("summary"), str):
        return "resume_payload summary"
    if "projects_start_on_new_page" in resume and not isinstance(resume["projects_start_on_new_page"], bool):
        return "resume_payload projects_start_on_new_page must be boolean"
    if any(not all(key in item for key in ("company", "role", "dates", "bullets")) or not isinstance(item["bullets"], list) for item in resume.get("experience", [])):
        return "resume experience schema"
    if any(not all(key in item for key in ("org", "title", "year")) for item in resume.get("education", [])):
        return "resume education schema"
    if any("name" not in item or not isinstance(item.get("bullets", []), list) for item in resume.get("projects", [])):
        return "resume project schema"
    if any("category" not in item or "items" not in item for item in resume.get("skills", [])):
        return "resume skills schema"
    return None


def scan_evaluate(payload: dict) -> dict:
    inputs = payload["inputs"]
    source = inputs["source"]
    adapter = model_adapter
    key = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    directory = DRAFT_ROOT / key
    directory.mkdir(parents=True, exist_ok=True)
    prompt = adapter.EVIDENCE + json.dumps({
        "source_capture": source,
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
        "liveness_reason": (
            f"{source.get('capture_method', 'unknown')} at {source['url']} returned "
            f"capture {source.get('liveness_evidence', {}).get('status', 'unknown')} "
            f"on {source['captured_at']}; content hash "
            f"{source.get('liveness_evidence', {}).get('content_hash', 'unknown')}"
        ) if source.get("liveness_evidence", {}).get("status") in (200, "captured") else evidence["liveness_reason"],
        "location_evidence": source.get("location_evidence"),
        "employment_evidence": source.get("employment_evidence"),
        "prescreen": prescreen,
    }
    return {"outcome": "jd_report", "artifact": report, "tool_calls": 1}


def apply_evaluate(payload: dict) -> dict:
    adapter = model_adapter
    prompt = """Prepare one application package from only the supplied candidate facts, completed JD scan, score report, rules, requirements, optional writing evidence and user feedback. Apply the market employment rule relevant to the posting; do not treat a remote label as proof of lawful employment.
For a first draft, return JSON with exactly these package fields:
- resume_payload: exact input for reactive-resume.mjs. candidate has name/email/phone/location and optional linkedin/github/portfolio {url,display}; headline and summary are strings; competencies is a string array; experience entries use {company,role,location,dates,bullets:string[]}; projects use {name,url,tech,badge,bullets:string[]}; education uses {org,title,year,description}; certifications and awards use {org,title,year}; skills use {category,items:string[]}. Optional projects_start_on_new_page is a boolean layout instruction; use true when layout feedback says the Projects heading is orphaned at a page end, otherwise false. Preserve facts; tailor experience through evidence-backed selection, ordering or rewriting. Never use points/institution/degree keys. Do not invent or upgrade prototypes.
- changes: Markdown listing every material CV change and its source evidence.
- cover_letter: write in the configured language.output, with the substance of a 250-300 word letter (adapt length naturally for Chinese). Address the company hiring team unless a named person is supplied. Open with the role and strongest evidence-backed match; map 3 concrete achievements to the role; explain why this company using only supplied evidence; close directly. Use active first-person language, no clichés, em dashes, empty praise, or invented company facts.
- upskill: a targeted interview-preparation plan derived from explicit JD gaps. Include a priority/type/source heatmap, themed learning entries with realistic hours, what to study, what the candidate can skip, a concrete practice artifact, and a dependency-aware study order with total hours. Do not invent courses, URLs, authors, or claims.
- interview_prep: grounded stories, risks and preparation topics.
- questions: questions for the employer, especially unresolved hard conditions.
Each of changes, cover_letter, upskill, interview_prep, and questions must be a Markdown STRING, not an array or object. Do not calculate a decimal-year career length from dates; use only the tenure wording explicitly supported by candidate sources. REST APIs, Docker deployment and a full-stack platform do not by themselves prove microservice architecture or delivery. Keep the resume skills concise and nonduplicative.
Write user-facing material in the configured output language. Never submit, send, contact anyone, or modify a base resume. No prose outside JSON.
"""
    if payload.get("previous_artifact"):
        prompt += """The previous_artifact is a draft, not evidence. Revise it only for the supplied feedback. Return a JSON object containing only changed top-level package fields; omit unchanged fields. If changing resume_payload, return its complete replacement. The unchanged fields will be retained and the merged package validated. Do not return an empty patch or extra fields.\n"""
    decision, _ = adapter.call_agent(
        "apply_evaluate",
        prompt + json.dumps(payload, ensure_ascii=False),
        [],
        DRAFT_ROOT,
    )
    previous = payload.get("previous_artifact")
    if previous:
        if not isinstance(previous, dict) or not isinstance(decision, dict) or not decision or set(decision) - set(previous):
            raise ValueError("Invalid application revision patch")
        decision = {**previous, **decision}
    defect = application_package_error(decision)
    calls = 1
    if defect:
        decision, _ = adapter.call_agent(
            "apply_repair",
            prompt
            + "\nReturn the complete six-field package. Correct only this schema defect: "
            + defect
            + "\n"
            + json.dumps({"inputs": payload, "incomplete_package": decision}, ensure_ascii=False),
            [],
            DRAFT_ROOT,
        )
        calls += 1
        defect = application_package_error(decision)
    if defect:
        raise ValueError("Invalid application package: " + defect)
    return {"outcome": "package", "artifact": decision, "tool_calls": calls}


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
                "evidence": jd["prescreen"].get("evidence") or reasons or [jd["url"]],
            },
            "tool_calls": 0,
        }
    key = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    directory = DRAFT_ROOT / key
    directory.mkdir(parents=True, exist_ok=True)
    cached_assessment = (
        json.loads((directory / "assessment.json").read_text())
        if (directory / "assessment.json").exists()
        else None
    )
    adapter = model_adapter
    tool_calls = 0
    if cached_assessment:
        research = {"sources": cached_assessment["sources"], "research": cached_assessment["research"]}
    else:
        research_inputs = {
            "url": jd["url"], "company": jd["company"], "role": jd["role"],
            "jd": jd["jd"], "date": jd.get("captured_at", "unknown"), "prompt": adapter.RESEARCH,
        }
        research = adapter.call_agent(
            "research", adapter.RESEARCH + json.dumps(research_inputs, ensure_ascii=False), ["web"], directory
        )[0]
        tool_calls += 5
    sources = {key: inputs[key] for key in ("cv", "profile", "targeting", "rules")}
    sources.update({key: inputs[key] for key in ("articles", "voice") if inputs.get(key)})
    sources.update({f"writing{index}": content for index, content in enumerate(inputs.get("writing_samples", {}).values(), 1)})
    assessment_inputs = {
        "url": jd["url"], "sources": sources,
        "evidence": jd, "research": research, "prompt": adapter.ASSESS,
    }
    prompt = adapter.ASSESS + json.dumps(assessment_inputs, ensure_ascii=False)
    if cached_assessment:
        assessment = cached_assessment
    else:
        assessment = adapter.call_agent("assessment", prompt, [], directory)[0]
        assessment.update(research)
        tool_calls += 1
    packet = {
        "url": jd["url"], "root": str(ROOT if directory.is_relative_to(ROOT) else DRAFT_ROOT.parent),
        "directory": str(directory),
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
    try:
        result = render_report(packet, evidence, assessment)
    except ValueError as error:
        frozen_sources = {**assessment_inputs["sources"], "jd": jd["jd"]}
        frozen_sources.update({source["id"]: source["text"] for source in research["sources"]})
        prompt = (
            adapter.ASSESS
            + "\nCorrect only these mechanical defects. Reuse completed research; no tools.\n"
            + str(error)
            + "\nEach dimension must contain exactly score, rationale, and evidence; put the full reasoning inside rationale."
            + "\nOnly source IDs in frozen_sources are valid. Remove or replace every other source ID. "
              "If a non-null dimension has no valid supporting quote, set its score to null and evidence to [].\n"
            + json.dumps(
                {
                    "assessment": assessment,
                    "frozen_sources": frozen_sources,
                    "research": research["research"],
                },
                ensure_ascii=False,
            )
        )
        assessment = adapter.call_agent("repair", prompt, [], directory)[0]
        assessment.update(research)
        write_json(directory / "assessment.json", assessment)
        result = render_report(packet, evidence, assessment)
        tool_calls += 1
    return {
        "outcome": "score",
        "artifact": {
            "type": "score", "report": result["report"], "report_sha256": result["report_sha256"],
            "draft_directory": str(directory), "liveness_reason": evidence["liveness_reason"],
            "score": result["attractiveness"],
        },
        "tool_calls": tool_calls,
    }


def main() -> None:
    payload = json.load(sys.stdin)
    phase = sys.argv[1]
    result = {
        "scan_evaluate": scan_evaluate,
        "apply_evaluate": apply_evaluate,
        "evaluate": evaluate,
    }[phase](payload)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
