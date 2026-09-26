"""Call the retained Reactive Resume tool and verify the rendered PDF."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def render_resume(
    task_id: str, version: int, artifact_root: Path, resume_json: Path,
    pdf_path: Path, profile: Path, candidate_name: str, company: str, role: str,
    timeout_seconds: int = 120,
) -> dict:
    """Produce one managed-copy PDF without touching the operational PDF index."""
    command = shlex.split(os.environ["CAREER_OPS_RESUME_RENDERER"]) if os.environ.get("CAREER_OPS_RESUME_RENDERER") else ["node", str(ROOT / "reactive-resume.mjs")]
    command += [
        str(resume_json), str(pdf_path), f"--task-id={task_id}",
        f"--artifact-root={artifact_root}", f"--profile={profile}",
        f"--metadata={pdf_path.with_name('reactive-resume.json')}",
        f"--version={version}", f"--company={company}", f"--role={role}",
    ]
    try:
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=timeout_seconds)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError(f"Reactive Resume export unavailable: {error}") from error
    if result.returncode:
        raise RuntimeError(f"Reactive Resume export failed: {result.stderr[-1500:]}")
    try:
        metadata = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError("Reactive Resume export returned no JSON receipt") from error
    if not isinstance(metadata, dict) or not isinstance(metadata.get("resumeId"), str) or not metadata["resumeId"]:
        raise ValueError("Reactive Resume export returned no resume identity")
    if not isinstance(metadata.get("outputPath"), str) or Path(metadata["outputPath"]).resolve() != pdf_path.resolve():
        raise ValueError("Reactive Resume export path does not match the package")
    metadata_path = pdf_path.with_name("reactive-resume.json")
    if (not isinstance(metadata.get("metadataPath"), str)
            or Path(metadata["metadataPath"]).resolve() != metadata_path.resolve()
            or not metadata_path.is_file()):
        raise ValueError("Reactive Resume metadata does not match the package")
    try:
        managed = json.loads(metadata_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("Reactive Resume metadata cannot be read") from error
    if (not isinstance(managed, dict) or managed.get("resume_id") != metadata["resumeId"]
            or managed.get("slug") != f"career-ops-workflow-{task_id}"
            or managed.get("last_artifact_version") != version):
        raise ValueError("Reactive Resume metadata is not bound to this package version")
    if not pdf_path.is_file() or pdf_path.stat().st_size < 100:
        raise ValueError("Reactive Resume PDF is missing or empty")
    try:
        info = subprocess.run(["pdfinfo", str(pdf_path)], text=True, capture_output=True, timeout=15)
        extracted = subprocess.run(["pdftotext", "-layout", str(pdf_path), "-"], text=True, capture_output=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError(f"PDF validation unavailable: {error}") from error
    pages = re.search(r"^Pages:\s+(\d+)\s*$", info.stdout, re.MULTILINE)
    if info.returncode or not pages or int(pages.group(1)) < 1 or extracted.returncode:
        raise ValueError("Reactive Resume PDF cannot be read")
    if " ".join(candidate_name.split()).casefold() not in " ".join(extracted.stdout.split()).casefold():
        raise ValueError("Reactive Resume PDF does not contain the candidate identity")
    source_text = json.dumps(json.loads(resume_json.read_text()), ensure_ascii=False)
    wrapped_compounds = re.findall(r"(?m)(\w+)-[ \t]*\r?\n\s*(\w+)", extracted.stdout)
    if (re.search(r"[ \t]-[ \t]*$", extracted.stdout, re.MULTILINE)
            or any(f"{left}-{right}" not in source_text for left, right in wrapped_compounds)):
        raise ValueError("Reactive Resume PDF contains non-source line-end hyphens")
    return {
        "resume_id": metadata["resumeId"], "pages": int(pages.group(1)),
        "text_sha256": hashlib.sha256(extracted.stdout.encode()).hexdigest(),
        "metadata_path": str(metadata_path),
    }
