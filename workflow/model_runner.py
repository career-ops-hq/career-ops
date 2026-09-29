"""Run isolated scan, score, and application generation for LangGraph."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys

from workflow.scan_graph import run_scan
from workflow.apply_graph import apply_evaluate as run_apply
from workflow.score_graph import run_score

ROOT = Path(__file__).resolve().parents[1]
DRAFT_ROOT = Path(os.environ["CAREER_OPS_DRAFT_ROOT"]) if "CAREER_OPS_DRAFT_ROOT" in os.environ else ROOT / "data" / "workflow-drafts"


def scan_evaluate(payload: dict) -> dict:
    """Enter the checkpointed scan graph through the isolated model process."""
    return run_scan(payload["inputs"], DRAFT_ROOT)


def apply_evaluate(payload: dict) -> dict:
    """Enter the application package graph through the isolated model process."""
    return run_apply(payload, DRAFT_ROOT)


def evaluate(payload: dict) -> dict:
    """Enter the checkpointed score graph through the isolated model process."""
    return run_score(payload["inputs"], DRAFT_ROOT, ROOT)


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
