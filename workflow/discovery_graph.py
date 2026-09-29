"""Checkpoint configured discovery while keeping large provider batches out of SQLite."""

from __future__ import annotations

from pathlib import Path
from typing import Callable, TypedDict
from uuid import uuid4

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

try:
    from workflow.artifacts import cached_artifact, load_artifact, save_artifact
except ModuleNotFoundError:
    from artifacts import cached_artifact, load_artifact, save_artifact


class DiscoveryState(TypedDict, total=False):
    collected: dict
    decision: dict
    result: dict


def run_discovery_graph(directory: Path, inputs_hash: str, cutoffs: dict, *, resume: bool,
                        collect: Callable[[dict], tuple[list, list[str]]],
                        decide: Callable[[list, list[str], dict, str], dict],
                        publish: Callable[[dict, str], dict],
                        collector_failure: Callable[[str, str], dict]) -> dict:
    """Run collect, decide and business publish as resumable graph nodes."""
    cache = directory / "cache" / "configured-discovery"
    pointer = cache / "latest.json"
    if resume:
        existing_pointer = cached_artifact(pointer)
        if existing_pointer is None:
            raise ValueError("No configured discovery run is available to resume")
        selected = load_artifact(existing_pointer)
        if selected.get("inputs_hash") != inputs_hash:
            raise ValueError("Configured discovery inputs changed since the interrupted run")
        run_id = selected["run_id"]
        cutoffs = selected["cutoffs"]
    else:
        run_id = uuid4().hex
        save_artifact(pointer, {"run_id": run_id, "inputs_hash": inputs_hash, "cutoffs": cutoffs})
    run_directory = cache / run_id

    def collect_node(state: DiscoveryState) -> dict:
        path = run_directory / "collected.json"
        cached = cached_artifact(path)
        if cached:
            return {"collected": cached}
        try:
            results, warnings = collect(cutoffs)
        except KeyboardInterrupt:
            try:
                collector_failure("Provider scanner interrupted", run_id)
            except Exception:
                pass
            raise
        except ValueError as error:
            return {"result": collector_failure(str(error), run_id)}
        return {"collected": save_artifact(path, {"results": results, "warnings": warnings})}

    def decide_node(state: DiscoveryState) -> dict:
        path = run_directory / "decision.json"
        cached = cached_artifact(path)
        if cached:
            return {"decision": cached}
        batch = load_artifact(state["collected"])
        return {"decision": save_artifact(path, decide(batch["results"], batch["warnings"], cutoffs, run_id))}

    def publish_node(state: DiscoveryState) -> dict:
        return {"result": publish(load_artifact(state["decision"]), run_id)}

    graph = StateGraph(DiscoveryState)
    graph.add_node("collect", collect_node)
    graph.add_node("decide", decide_node)
    graph.add_node("publish", publish_node)
    graph.add_edge(START, "collect")
    graph.add_conditional_edges("collect", lambda state: "done" if state.get("result") else "decide",
                                {"done": END, "decide": "decide"})
    graph.add_edge("decide", "publish")
    graph.add_edge("publish", END)
    config = {"configurable": {"thread_id": run_id}}
    cache.mkdir(parents=True, exist_ok=True)
    with SqliteSaver.from_conn_string(str(cache / "checkpoints.db")) as saver:
        compiled = graph.compile(checkpointer=saver)
        checkpoint = compiled.get_state(config)
        if checkpoint.next:
            result = compiled.invoke(None, config)
        elif checkpoint.values.get("result"):
            result = ({"result": publish(load_artifact(checkpoint.values["decision"]), run_id)}
                      if checkpoint.values.get("decision") else checkpoint.values)
        else:
            result = compiled.invoke({}, config)
    return result["result"]
