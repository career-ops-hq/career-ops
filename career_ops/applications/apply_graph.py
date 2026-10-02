"""Prepare evidence-bounded application packages through LangGraph."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from career_ops import model as model_adapter


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
    basics = resume.get("basics")
    if "candidate" not in resume and isinstance(basics, dict) and basics.get("name"):
        candidate = {key: basics[key] for key in ("name", "email", "phone", "location") if key in basics}
        profiles = basics.get("profiles")
        for profile in (profiles if isinstance(profiles, list) else []):
            if not isinstance(profile, dict) or not isinstance(profile.get("url"), str):
                continue
            network = str(profile.get("network", "")).lower()
            if network in {"linkedin", "github", "portfolio"}:
                candidate[network] = {"url": profile["url"], "display": profile["url"]}
        resume.pop("basics")
        resume["candidate"] = candidate
        for key in ("headline", "summary"):
            if key not in resume and key in basics:
                resume[key] = basics[key]
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


def _prompt(payload: dict) -> str:
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
    return prompt


class ApplyState(TypedDict, total=False):
    payload: dict
    prompt: str
    decision: dict
    defect: str | None
    outcome: str
    artifact: dict
    tool_calls: int


def apply_evaluate(payload: dict, draft_root: Path) -> dict:
    """Resume drafting and repair without repeating completed model calls."""
    key = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    directory = draft_root / key
    directory.mkdir(parents=True, exist_ok=True)

    def draft(state: ApplyState) -> dict:
        prompt = _prompt(state["payload"])
        decision = model_adapter.call_agent(
            "apply_evaluate", prompt + json.dumps(state["payload"], ensure_ascii=False),
            [], directory,
        )[0]
        return {"prompt": prompt, "decision": decision, "tool_calls": 1}

    def merge_revision(state: ApplyState) -> dict:
        previous = state["payload"].get("previous_artifact")
        if not previous:
            return {"decision": state["decision"]}
        decision = state["decision"]
        if not isinstance(previous, dict) or not isinstance(decision, dict) or not decision or set(decision) - set(previous):
            raise ValueError("Invalid application revision patch")
        return {"decision": {**previous, **decision}}

    def validate(state: ApplyState) -> dict:
        decision = state["decision"]
        return {"decision": decision, "defect": application_package_error(decision)}

    def repair(state: ApplyState) -> dict:
        decision = model_adapter.call_agent(
            "apply_repair",
            state["prompt"]
            + "\nReturn the complete six-field package. Correct only this schema defect: "
            + state["defect"]
            + "\n"
            + json.dumps({"inputs": state["payload"], "incomplete_package": state["decision"]}, ensure_ascii=False),
            [], directory,
        )[0]
        return {"decision": decision, "tool_calls": state["tool_calls"] + 1}

    def finish(state: ApplyState) -> dict:
        defect = application_package_error(state["decision"])
        if defect:
            raise ValueError("Invalid application package: " + defect)
        return {"outcome": "package", "artifact": state["decision"]}

    graph = StateGraph(ApplyState)
    graph.add_node("draft", draft)
    graph.add_node("merge_revision", merge_revision)
    graph.add_node("validate", validate)
    graph.add_node("repair", repair)
    graph.add_node("finish", finish)
    graph.add_edge(START, "draft")
    graph.add_edge("draft", "merge_revision")
    graph.add_edge("merge_revision", "validate")
    graph.add_conditional_edges("validate", lambda state: "repair" if state["defect"] else "finish",
                                {"repair": "repair", "finish": "finish"})
    graph.add_edge("repair", "finish")
    graph.add_edge("finish", END)
    config = {"configurable": {"thread_id": key}}
    with SqliteSaver.from_conn_string(str(directory / "apply-checkpoints.db")) as saver:
        compiled = graph.compile(checkpointer=saver)
        checkpoint = compiled.get_state(config)
        if checkpoint.next:
            result = compiled.invoke(None, config)
        elif checkpoint.values and checkpoint.values.get("artifact"):
            result = checkpoint.values
        else:
            result = compiled.invoke({"payload": payload, "tool_calls": 0}, config)
    return {"outcome": result["outcome"], "artifact": result["artifact"], "tool_calls": result["tool_calls"]}
