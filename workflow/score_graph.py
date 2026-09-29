"""Run score research, assessment, and report validation as durable LangGraph nodes."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from workflow import model_adapter
from workflow.report import render_report


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


def run_score(inputs: dict, draft_root: Path, root: Path) -> dict:
    """Resume an interrupted score stage before starting a fresh evaluation."""
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
        assessment_path = directory / "assessment.json"
        if assessment_path.exists():
            cached = json.loads(assessment_path.read_text())
            return {"research": {"sources": cached["sources"], "research": cached["research"]}}
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
            return {"research": json.loads(research_path.read_text())}
        usage = {}
        result = model_adapter.call_agent(
            "research", model_adapter.RESEARCH + json.dumps(research_inputs, ensure_ascii=False),
            ["web"], directory, usage=usage,
        )[0]
        model_adapter.save(research_path, result)
        model_adapter.save(checkpoint_path, {
            "input_hash": research_key, "output_hash": hashlib.sha256(research_path.read_bytes()).hexdigest(),
        })
        return {"research": result, "tool_calls": state["tool_calls"] + 1 + usage.get("tool_calls", 0)}

    def assess(state: ScoreState) -> dict:
        values, jd = state["inputs"], state["inputs"]["jd_report"]
        sources = {name: values[name] for name in ("cv", "profile", "targeting", "rules")}
        sources.update({name: values[name] for name in ("articles", "voice") if values.get(name)})
        sources.update({f"writing{index}": content for index, content in enumerate(values.get("writing_samples", {}).values(), 1)})
        assessment_inputs = {
            "url": jd["url"], "sources": sources,
            "evidence": jd, "research": state["research"], "prompt": model_adapter.ASSESS,
        }
        assessment_path = directory / "assessment.json"
        if assessment_path.exists():
            assessment = _normalize_assessment(json.loads(assessment_path.read_text()))
            calls = state["tool_calls"]
        else:
            prompt = model_adapter.ASSESS + json.dumps(assessment_inputs, ensure_ascii=False)
            assessment = _normalize_assessment(model_adapter.call_agent("assessment", prompt, [], directory)[0])
            assessment.update(state["research"])
            calls = state["tool_calls"] + 1
        packet = {
            "url": jd["url"], "root": str(root if directory.is_relative_to(root) else draft_root.parent),
            "directory": str(directory), "fingerprint": key, "sources": sources,
        }
        evidence = {
            "company": jd["company"], "role": jd["role"], "complete_jd": True,
            "liveness": "active", "liveness_reason": jd.get("liveness_reason", "JD report verified active"),
            "prescreen": jd["prescreen"], "jd": jd["jd"],
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
        try:
            result = render_report(state["packet"], state["evidence"], assessment)
            calls = state["tool_calls"]
        except ValueError as error:
            frozen_sources = {**state["packet"]["sources"], "jd": state["evidence"]["jd"]}
            frozen_sources.update({source["id"]: source["text"] for source in state["research"]["sources"]})
            prompt = (
                "Repair this assessment using only the supplied frozen sources. Do not research or invent evidence. "
                "Return a bare JSON object with top-level direction, compensation, team, company, "
                "advertised_comp, and sections; never wrap it in assessment. "
                "Each dimension must contain exactly score, rationale, and evidence. "
                "Only IDs in frozen_sources are citation sources; research is not a source ID. "
                "If a non-null dimension lacks a valid exact quote, set its score to null, evidence to [], "
                "and its rationale to an explicit Unknown. Remove unsupported claims and stale scores "
                "from every section, including overview and checklist. Reuse valid claims.\n"
                + str(error) + "\n"
                + json.dumps({"assessment": assessment, "frozen_sources": frozen_sources,
                              "research": state["research"]["research"]}, ensure_ascii=False)
            )
            assessment = _normalize_assessment(model_adapter.call_agent("repair", prompt, [], directory)[0])
            assessment.update(state["research"])
            _write_json(assessment_path, assessment)
            result = render_report(state["packet"], state["evidence"], assessment)
            calls = state["tool_calls"] + 1
        return {
            "outcome": "score", "tool_calls": calls,
            "artifact": {
                "type": "score", "report": result["report"], "report_sha256": result["report_sha256"],
                "draft_directory": str(directory), "liveness_reason": state["evidence"]["liveness_reason"],
                "score": result["attractiveness"],
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
