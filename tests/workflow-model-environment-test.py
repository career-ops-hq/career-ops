"""Keep model subprocesses in the workflow interpreter that owns LangGraph."""

import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workflow.career_ops import Runtime


class Store:
    path = Path("/tmp/career-ops-model-environment.db")

    def task(self, task_id):
        return {"attempt_tool_calls": 0, "attempt_elapsed_seconds": 0}

    def add_usage(self, task_id, elapsed, calls):
        return {"attempt_tool_calls": calls, "tool_calls": calls}


store = Store()
with patch.dict(os.environ, {"CAREER_OPS_MODEL_RUNNER": ""}), patch("workflow.career_ops.subprocess.Popen") as popen:
    process = popen.return_value.__enter__.return_value
    process.communicate.return_value = (json.dumps({"artifact": {}, "tool_calls": 2}), "")
    process.returncode = 0
    result = Runtime(store, Path("/tmp")).run_model("scan_evidence", {}, {"task_id": "test"})
    assert result["artifact"] == {}
    assert result["tool_calls"] == 0
    assert popen.call_args.args[0][:3] == [sys.executable, "-m", "workflow.model_runner"]
