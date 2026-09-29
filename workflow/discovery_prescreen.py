"""Retain an honest Stage 0 placeholder for a newly surfaced posting."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

try:
    from workflow.prescreen import evaluate
except ModuleNotFoundError:
    from prescreen import evaluate


def _hash(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _read(path: Path) -> str:
    try:
        return path.read_text()
    except FileNotFoundError:
        return ""


def candidate_source_hash(input_root: Path, profile: Path) -> str:
    """Bind the cache placeholder to the candidate sources Node used."""
    return _hash({"cv": _read(input_root / "cv.md"), "profile": _read(profile),
                  "profileRules": _read(input_root / "modes" / "_profile.md")})


def placeholder(offer: dict, source_hash: str) -> tuple[dict, dict]:
    url = str(offer.get("url") or "").strip().split()
    clean_url = url[0] if url else ""
    input_value = {"job": {"url": clean_url, "title": offer.get("title") or None,
                           "company": offer.get("company") or None,
                           "listing_hash": _hash({"location": offer.get("location") or None,
                                                  "salary": offer.get("salary") or None,
                                                  "description": offer.get("description") or None})},
                   "candidate_source_hash": source_hash,
                   "complete_jd": False, "assessment_complete": False}
    result = evaluate(input_value)
    return input_value, result


def write_placeholder(offer: dict, source_hash: str, cache_root: Path) -> Path:
    input_value, result = placeholder(offer, source_hash)
    url = input_value["job"]["url"]
    path = cache_root / (_hash(url)[:24] + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps({"url": url, "input": input_value, "result": result},
                                    ensure_ascii=False, indent=2) + "\n")
    os.replace(temporary, path)
    return path
