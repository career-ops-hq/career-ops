"""Hash the candidate sources that bind configured discovery."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


def _hash(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _read(path: Path) -> str:
    try:
        return path.read_text()
    except FileNotFoundError:
        return ""


def candidate_source_hash(input_root: Path, profile: Path) -> str:
    """Bind discovery to the candidate source bytes."""
    return _hash({"cv": _read(input_root / "cv.md"), "profile": _read(profile),
                  "profileRules": _read(input_root / "modes" / "_profile.md")})

