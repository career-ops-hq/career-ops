"""Run score research, assessment, and report validation as durable LangGraph nodes."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from workflow import model_adapter
from workflow.report import conflicting_sections, render_report


class ScoreState(TypedDict, total=False):
    inputs: dict
    outcome: str
    artifact: dict
    research: dict
    assessment: dict
    packet: dict
    evidence: dict
    tool_calls: int


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def _normalize_assessment(assessment: dict) -> dict:
    for dimension in assessment["dimensions"].values():
        if not isinstance(dimension, dict):
            continue
        extra = sorted(set(dimension) - {"score", "rationale", "evidence"})
        if extra and isinstance(dimension.get("rationale"), str) and all(
            isinstance(dimension[key], str) and dimension[key].strip() for key in extra
        ):
            dimension["rationale"] += "\n" + "\n".join(f"{key}: {dimension.pop(key)}" for key in extra)
    return assessment


def _complete_sections(assessment: dict, jd: dict, sources: dict, research: dict, directory: Path) -> tuple[dict, int]:
    required = ("overview", "capabilities", "compensation", "questions", "legitimacy", "risks", "checklist")
    def section_text(value: object) -> str | None:
        if isinstance(value, str) and value.strip():
            return value
        if isinstance(value, list) and value and all(isinstance(item, str) and item.strip() for item in value):
            return "\n".join(f"- {item}" for item in value)
        return None

    original = assessment.get("sections")
    sections = {name: section_text(original.get(name)) for name in required} if isinstance(original, dict) else {}
    missing = [name for name in required if sections.get(name) is None]
    if not missing:
        return {**assessment, "sections": sections}, 0
    prompt = (
        "Complete only these missing score report sections as a JSON object with exactly these top-level keys: "
        + ", ".join(missing) + ". Write concise Chinese Markdown strings without level-two headings. "
        "Map every material requirement when capabilities is requested. Keep unknown facts unknown. "
        "Ground claims only in the supplied JD, candidate sources, frozen research, and existing dimension judgments. "
        "Structured location_evidence is official location evidence; do not claim the city is undisclosed when present. "
        "A browser_snapshot liveness_reason records a page capture; do not claim no snapshot exists. "
        "Do not repeat existing sections or change dimension scores.\n"
        + json.dumps({"jd_report": jd, "candidate_sources": sources, "research": research,
                      "dimensions": assessment["dimensions"],
                      "existing_sections": [name for name, value in sections.items() if value]}, ensure_ascii=False)
    )
    added = model_adapter.call_agent("score_sections", prompt, [], directory)[0]
    completed = {name: section_text(added.get(name)) for name in missing}
    if any(value is None for value in completed.values()):
        raise ValueError("Score section completion is incomplete")
    return {**assessment, "sections": {**sections, **completed}}, 1


def _complete_dimensions(assessment: dict, jd: dict, sources: dict, research: dict, directory: Path) -> tuple[dict, int]:
    dimensions = dict(assessment["dimensions"])
    calls = 0
    for name in ("direction", "compensation", "company"):
        value = dimensions.get(name)
        if (isinstance(value, dict) and set(value) == {"score", "rationale", "evidence"}
                and isinstance(value["rationale"], str) and value["rationale"].strip()
                and isinstance(value["evidence"], list)
                and (value["score"] is None or value["evidence"])
                and (value["score"] is None or type(value["score"]) is int and 1 <= value["score"] <= 5)):
            continue
        prompt = (
            f"Repair only the {name} score dimension. Return one JSON object with exactly score, rationale, evidence. "
            "Score must be an integer 1–5 or null. Each evidence item must have a frozen source ID and an exact contiguous quote. "
            "Explain fact, applicability, inference, and rating. If evidence cannot support a rating, use score:null and explain Unknown. "
            "Do not change other dimensions or report sections.\n"
            + json.dumps({"previous": value, "jd_report": jd, "candidate_sources": sources,
                          "research": research}, ensure_ascii=False)
        )
        repaired = model_adapter.call_agent("score_dimension", prompt, [], directory)[0]
        if (set(repaired) != {"score", "rationale", "evidence"}
                or not isinstance(repaired["rationale"], str) or not repaired["rationale"].strip()
                or not isinstance(repaired["evidence"], list)
                or (repaired["score"] is not None and (type(repaired["score"]) is not int or not 1 <= repaired["score"] <= 5 or not repaired["evidence"]))):
            raise ValueError(f"{name}: repaired dimension is incomplete")
        dimensions[name] = repaired
        calls += 1
    return {**assessment, "dimensions": dimensions}, calls


def run_score(inputs: dict, draft_root: Path, root: Path) -> dict:
    """Resume an interrupted score stage before starting a fresh evaluation."""
    draft_root = draft_root.resolve()
    key = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    directory = draft_root / key
    directory.mkdir(parents=True, exist_ok=True)

    def prescreen(state: ScoreState) -> dict:
        jd = state["inputs"]["jd_report"]
        if jd["prescreen"]["status"] != "fail":
            return {"outcome": "score"}
        reasons = jd["prescreen"].get("discard_reasons", [])
        return {
            "outcome": "exclude",
            "artifact": {
                "type": "exclusion",
                "reason": jd["prescreen"].get("reason") or "; ".join(item["message"] for item in reasons),
                "evidence": jd["prescreen"].get("evidence") or reasons or [jd["url"]],
            },
        }

    def research(state: ScoreState) -> dict:
        jd = state["inputs"]["jd_report"]
        research_inputs = {
            "url": jd["url"], "company": jd["company"], "role": jd["role"],
            "jd": jd["jd"], "date": jd.get("captured_at", "unknown"), "prompt": model_adapter.RESEARCH,
        }
        research_path = directory / "research-result.json"
        checkpoint_path = directory / "research-result.checkpoint.json"
        research_key = hashlib.sha256(json.dumps(research_inputs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        checkpoint = json.loads(checkpoint_path.read_text()) if checkpoint_path.exists() else {}
        if (research_path.exists() and checkpoint.get("input_hash") == research_key
                and checkpoint.get("output_hash") == hashlib.sha256(research_path.read_bytes()).hexdigest()):
            return {"research": model_adapter.normalize_research(json.loads(research_path.read_text()))}
        usage = {}
        result = model_adapter.normalize_research(model_adapter.call_agent(
            "research", model_adapter.RESEARCH + json.dumps(research_inputs, ensure_ascii=False),
            ["web"], directory, usage=usage,
        )[0])
        model_adapter.save(research_path, result)
        model_adapter.save(checkpoint_path, {
            "input_hash": research_key, "output_hash": hashlib.sha256(research_path.read_bytes()).hexdigest(),
        })
        return {"research": result, "tool_calls": state["tool_calls"] + 1 + usage.get("tool_calls", 0)}

    def assess(state: ScoreState) -> dict:
        values, jd = state["inputs"], state["inputs"]["jd_report"]
        research = model_adapter.normalize_research(state["research"])
        sources = {name: values[name] for name in ("cv", "profile", "targeting", "rules")}
        sources.update({name: values[name] for name in ("articles", "voice") if values.get(name)})
        sources.update({f"writing{index}": content for index, content in enumerate(values.get("writing_samples", {}).values(), 1)})
        assessment_inputs = {
            "url": jd["url"], "sources": sources,
            "evidence": jd, "research": research, "prompt": model_adapter.ASSESS,
        }
        assessment_path = directory / "assessment.json"
        if assessment_path.exists():
            assessment = _normalize_assessment(json.loads(assessment_path.read_text()))
            assessment.update(research)
            calls = state["tool_calls"]
        else:
            prompt = model_adapter.ASSESS + json.dumps(assessment_inputs, ensure_ascii=False)
            assessment = _normalize_assessment(model_adapter.call_agent("assessment", prompt, [], directory)[0])
            assessment.update(research)
            calls = state["tool_calls"] + 1
        packet = {
            "url": jd["url"], "root": str(root if directory.is_relative_to(root) else draft_root.parent),
            "directory": str(directory), "fingerprint": key, "sources": sources,
        }
        evidence = {
            "company": jd["company"], "role": jd["role"], "complete_jd": True,
            "liveness": "active", "liveness_reason": jd.get("liveness_reason", "JD report verified active"),
            "location_evidence": jd.get("location_evidence"), "employment_evidence": jd.get("employment_evidence"),
            "captured_at": jd.get("captured_at"), "prescreen": jd["prescreen"], "jd": jd["jd"],
        }
        _write_json(directory / "packet.json", packet)
        _write_json(directory / "evidence.json", evidence)
        _write_json(assessment_path, assessment)
        for source_id, content in sources.items():
            (directory / f"{source_id}.txt").write_text(content)
        return {"assessment": assessment, "packet": packet, "evidence": evidence, "tool_calls": calls}

    def render(state: ScoreState) -> dict:
        assessment_path = directory / "assessment.json"
        assessment = json.loads(assessment_path.read_text()) if assessment_path.exists() else state["assessment"]
        research = model_adapter.normalize_research(state["research"])
        assessment.update(research)
        invalid = conflicting_sections(assessment.get("sections", {}), state["evidence"])
        if invalid:
            assessment = {**assessment, "sections": {
                name: body for name, body in assessment["sections"].items() if name not in invalid
            }}
        assessment, dimension_calls = _complete_dimensions(
            assessment, state["inputs"]["jd_report"], state["packet"]["sources"], research, directory
        )
        if dimension_calls:
            _write_json(assessment_path, assessment)
        previous_sections = assessment.get("sections")
        assessment, section_calls = _complete_sections(
            assessment, state["inputs"]["jd_report"], state["packet"]["sources"], research, directory
        )
        conflicts = conflicting_sections(assessment["sections"], state["evidence"])
        if conflicts:
            assessment["sections"] = {
                name: body for name, body in assessment["sections"].items() if name not in conflicts
            }
            assessment, correction_calls = _complete_sections(
                assessment, state["inputs"]["jd_report"], state["packet"]["sources"], research, directory
            )
            section_calls += correction_calls
        if section_calls or assessment["sections"] != previous_sections:
            _write_json(assessment_path, assessment)
        try:
            result = render_report(state["packet"], state["evidence"], assessment)
            calls = state["tool_calls"] + dimension_calls + section_calls
        except ValueError as error:
            frozen_sources = {**state["packet"]["sources"], "jd": state["evidence"]["jd"]}
            frozen_sources.update({source["id"]: source["text"] for source in research["sources"]})
            prompt = (
                "Repair this assessment using only the supplied frozen sources. Do not research or invent evidence. "
                "Return a bare JSON object with top-level direction, compensation, company, "
                "advertised_comp, and sections; never wrap it in assessment. "
                "Each dimension must contain exactly score, rationale, and evidence. "
                "Only IDs in frozen_sources are citation sources; research is not a source ID. "
                "If a non-null dimension lacks a valid exact quote, set its score to null, evidence to [], "
                "and its rationale to an explicit Unknown. Remove unsupported claims and stale scores "
                "from every section, including overview and checklist. Reuse valid claims.\n"
                + str(error) + "\n"
                + json.dumps({"assessment": assessment, "frozen_sources": frozen_sources,
                              "research": research["research"]}, ensure_ascii=False)
            )
            assessment = _normalize_assessment(model_adapter.call_agent("repair", prompt, [], directory)[0])
            assessment.update(research)
            assessment, repair_sections = _complete_sections(
                assessment, state["inputs"]["jd_report"], state["packet"]["sources"], research, directory
            )
            conflicts = conflicting_sections(assessment["sections"], state["evidence"])
            if conflicts:
                assessment["sections"] = {
                    name: body for name, body in assessment["sections"].items() if name not in conflicts
                }
                assessment, corrected = _complete_sections(
                    assessment, state["inputs"]["jd_report"], state["packet"]["sources"], research, directory
                )
                repair_sections += corrected
            _write_json(assessment_path, assessment)
            result = render_report(state["packet"], state["evidence"], assessment)
            calls = state["tool_calls"] + dimension_calls + section_calls + 1 + repair_sections
        return {
            "outcome": "score", "tool_calls": calls,
            "artifact": {
                "type": "score", "report": result["report"], "report_sha256": result["report_sha256"],
                "draft_directory": str(directory), "liveness_reason": state["evidence"]["liveness_reason"],
                "score": result["scores"],
            },
        }

    graph = StateGraph(ScoreState)
    graph.add_node("prescreen", prescreen)
    graph.add_node("research", research)
    graph.add_node("assessment", assess)
    graph.add_node("render", render)
    graph.add_edge(START, "prescreen")
    graph.add_conditional_edges("prescreen", lambda state: state["outcome"],
                                {"exclude": END, "score": "research"})
    graph.add_edge("research", "assessment")
    graph.add_edge("assessment", "render")
    graph.add_edge("render", END)
    config = {"configurable": {"thread_id": key}}
    with SqliteSaver.from_conn_string(str(directory / "score-checkpoints.db")) as saver:
        compiled = graph.compile(checkpointer=saver)
        checkpoint = compiled.get_state(config)
        if checkpoint.next:
            result = compiled.invoke(None, config)
        elif checkpoint.values and checkpoint.values.get("artifact"):
            artifact = checkpoint.values["artifact"]
            report_path = directory / "report.md"
            if artifact.get("type") != "score" or (report_path.is_file()
                    and hashlib.sha256(report_path.read_bytes()).hexdigest() == artifact.get("report_sha256")):
                result = checkpoint.values
            else:
                result = compiled.invoke({"inputs": inputs, "tool_calls": 0}, config)
        else:
            result = compiled.invoke({"inputs": inputs, "tool_calls": 0}, config)
    return {"outcome": result["outcome"], "artifact": result["artifact"], "tool_calls": result["tool_calls"]}
