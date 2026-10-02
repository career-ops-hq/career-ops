"""Own runtime constants and local environment loading."""

from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv


os.environ.setdefault("LANGGRAPH_STRICT_MSGPACK", "true")

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env", override=False)

INPUT_ROOT = Path(os.environ.get("CAREER_OPS_INPUT_ROOT", ROOT / "inputs"))
RULES_ROOT = INPUT_ROOT.parent / "rules"


def source_path(input_root: Path, logical_name: str) -> Path:
    """Resolve stable evidence labels to their current physical source files."""
    names = {"config/profile.yml": "profile.yml", "config/cv-facts.json": "cv-facts.json",
             "modes/_profile.md": "targeting.md", "voice-dna.md": "voice.md",
             "interview-prep/story-bank.md": "stories/story-bank.md"}
    if logical_name == "modes/_custom.md":
        return input_root.parent / "rules" / "scoring.md"
    if logical_name.startswith("prompts/"):
        return input_root.parent / "rules" / logical_name.removeprefix("prompts/")
    if logical_name.startswith("markets/"):
        return input_root.parent / "rules" / logical_name
    return input_root / names.get(logical_name, logical_name)

WORKFLOW_VERSION = "oii-333-v1"

SCAN_POLICY_VERSION = 2

SCORE_POLICY_VERSION = 3

ATTEMPT_SECONDS = 900

ATTEMPT_CALLS = 20

MODEL_RUNNER = "career_ops.model_runner"


def load_project_environment(root: Path) -> None:
    """Load project settings while preserving explicit inherited environment values."""
    load_dotenv(root / ".env", override=False)
