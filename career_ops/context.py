"""Own runtime constants and local environment loading."""

from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv


os.environ.setdefault("LANGGRAPH_STRICT_MSGPACK", "true")

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env", override=False)

INPUT_ROOT = Path(os.environ.get("CAREER_OPS_INPUT_ROOT", ROOT))

WORKFLOW_VERSION = "oii-333-v1"

SCAN_POLICY_VERSION = 2

SCORE_POLICY_VERSION = 3

ATTEMPT_SECONDS = 900

ATTEMPT_CALLS = 20

MODEL_RUNNER = "career_ops.model_runner"


def load_project_environment(root: Path) -> None:
    """Load project settings while preserving explicit inherited environment values."""
    load_dotenv(root / ".env", override=False)
