"""Run dashboard actions as background CLI processes; the CLI owns all workflow state."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import threading


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_LIMIT = 4000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _command(action: str, opportunity_id: int) -> list[str]:
    target = str(opportunity_id)
    if action == "prepare":
        # --re-evaluate is safe: unchanged inputs reuse the stored package and a waiting
        # draft is returned as-is, so a model call only happens for new inputs.
        return ["apply", "prepare", target, "--re-evaluate"]
    if action == "rescore":
        # Re-score the retained JD against current candidate and policy inputs without rescanning.
        return ["task", "start", "score", target, f"scan:{target}", "--re-evaluate"]
    raise ValueError(f"Unknown dashboard action: {action}")


ACTIONS = ("prepare", "rescore")


class ActionRunner:
    """At most one running action per opportunity."""

    def __init__(self, directory: Path):
        self.directory = directory
        self.lock = threading.Lock()
        self.runs: dict[int, dict] = {}

    def status(self, opportunity_id: int) -> dict | None:
        with self.lock:
            run = self.runs.get(opportunity_id)
            return dict(run) if run else None

    def statuses(self) -> dict[int, dict]:
        with self.lock:
            return {key: {"action": run["action"], "status": run["status"]} for key, run in self.runs.items()}

    def start(self, opportunity_id: int, action: str) -> dict:
        command = [sys.executable, "-B", "-m", "career_ops", "--directory", str(self.directory),
                   *_command(action, opportunity_id)]
        with self.lock:
            current = self.runs.get(opportunity_id)
            if current and current["status"] == "running":
                raise RuntimeError("Another dashboard action is already running for this opportunity")
            run = {"action": action, "status": "running", "started_at": _now(), "finished_at": None,
                   "task": None, "error": None}
            self.runs[opportunity_id] = run
        threading.Thread(target=self._run, args=(opportunity_id, command), daemon=True).start()
        return dict(run)

    def _run(self, opportunity_id: int, command: list[str]) -> None:
        try:
            result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
            task, error = None, None
            if result.returncode == 0:
                task = json.loads(result.stdout)
            else:
                error = (result.stderr or result.stdout).strip()[-OUTPUT_LIMIT:] or f"exit code {result.returncode}"
        except Exception as exception:  # report launcher failures to the page
            task, error = None, repr(exception)
        with self.lock:
            self.runs[opportunity_id] = {
                **self.runs[opportunity_id], "finished_at": _now(),
                "status": "failed" if error else "succeeded", "error": error,
                "task": {key: task.get(key) for key in ("task_id", "status", "reason", "allowed_actions")} if task else None,
            }
