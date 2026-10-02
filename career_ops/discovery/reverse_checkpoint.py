"""Persist a reverse ATS sweep's original window and exact resume position."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
import tempfile


VERSION = 3


def load_checkpoint(path: Path) -> dict | None:
    try:
        checkpoint = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(checkpoint, dict) or checkpoint.get("version") != VERSION:
        return None
    if not isinstance(checkpoint.get("run_id"), str) or not checkpoint["run_id"]:
        return None
    if (not isinstance(checkpoint.get("cutoff_ms"), (int, float)) or isinstance(checkpoint["cutoff_ms"], bool)
            or not math.isfinite(checkpoint["cutoff_ms"])):
        return None
    if (not isinstance(checkpoint.get("completed_sources"), list)
            or any(not isinstance(name, str) for name in checkpoint["completed_sources"])
            or not isinstance(checkpoint.get("offers"), list)):
        return None
    health = checkpoint.get("source_health")
    if (not isinstance(health, list) or any(not isinstance(item, dict)
            or not all(isinstance(item.get(key), str) for key in ("company", "status", "timestamp"))
            for item in health)):
        return None
    if not set(checkpoint["completed_sources"]).issubset({item["company"] for item in health}):
        return None
    current = checkpoint.get("current")
    if current is not None and (not isinstance(current, dict)
                                or not isinstance(current.get("name"), str)
                                or not all(isinstance(current.get(key), int) and not isinstance(current[key], bool)
                                           and current[key] >= 0
                                           for key in ("resume_at", "dataset_len"))
                                or not isinstance(current.get("dataset_hash"), str)):
        return None
    return checkpoint


def compatible(checkpoint: dict | None, *, ats: list[str], seeds: list[str], limit: int | None,
               include_undated: bool, shuffle: bool) -> bool:
    return bool(checkpoint and not shuffle and checkpoint.get("ats") == ats
                and checkpoint.get("seeds") == seeds and checkpoint.get("limit") == limit
                and checkpoint.get("include_undated") is include_undated)


def resume_at(checkpoint: dict, source: str, values: list, fingerprint: str, *, entries_len: int | None = None) -> int:
    """Reject a reordered dataset rather than silently skipping changed boards."""
    current = checkpoint.get("current")
    if not current or current["name"] != source:
        return 0
    if current["dataset_len"] != len(values) or current["dataset_hash"] != fingerprint:
        raise ValueError(f"{source} company dataset changed since checkpoint")
    if current["resume_at"] > (entries_len if entries_len is not None else len(values)):
        raise ValueError(f"{source} checkpoint position exceeds dataset")
    return current["resume_at"]


def write_checkpoint(path: Path, checkpoint: dict) -> bool:
    """A failed checkpoint write loses resumability without losing collected offers."""
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=path.name + ".tmp-", dir=path.parent)
        with os.fdopen(descriptor, "w") as stream:
            json.dump({"version": VERSION, **checkpoint}, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        return True
    except OSError:
        return False
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
