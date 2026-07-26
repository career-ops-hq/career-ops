"""Structured file IO helpers for YAML and JSON fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml


def load_yaml(path: str | Path) -> Any:
    """Load a YAML document from disk."""

    with Path(path).open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def write_yaml(path: str | Path, data: Any) -> None:
    """Write a YAML document with deterministic key ordering disabled."""

    with Path(path).open("w", encoding="utf-8") as handle:
        yaml.safe_dump(data, handle, sort_keys=False)


def write_json(path: str | Path, data: Any) -> None:
    """Write formatted JSON for machine-readable tracker/export artifacts."""

    with Path(path).open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
