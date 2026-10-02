"""Store large workflow stage results outside LangGraph checkpoints with integrity hashes."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from uuid import uuid4


def save_artifact(path: Path, value: object) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)
    digest = hashlib.sha256(payload).hexdigest()
    digest_path = path.with_suffix(path.suffix + ".sha256")
    temporary_digest = digest_path.with_name(digest_path.name + "." + uuid4().hex + ".tmp")
    temporary_digest.write_text(digest)
    temporary_digest.replace(digest_path)
    return {"path": str(path), "sha256": digest}


def load_artifact(reference: dict) -> object:
    payload = Path(reference["path"]).read_bytes()
    if hashlib.sha256(payload).hexdigest() != reference["sha256"]:
        raise ValueError("Workflow artifact changed after checkpoint")
    return json.loads(payload)


def cached_artifact(path: Path) -> dict | None:
    digest_path = path.with_suffix(path.suffix + ".sha256")
    if not path.is_file() or not digest_path.is_file():
        return None
    reference = {"path": str(path), "sha256": digest_path.read_text()}
    load_artifact(reference)
    return reference
