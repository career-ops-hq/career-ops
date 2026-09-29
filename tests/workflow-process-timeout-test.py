"""Ensure a timed-out model attempt cannot leave its subprocess descendants running."""

import os
from pathlib import Path
import sys
import tempfile
import time
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workflow.career_ops import BusinessStore, Runtime


with tempfile.TemporaryDirectory(prefix="career-ops-process-timeout-") as temporary:
    directory = Path(temporary)
    marker = directory / "orphan.txt"
    runner = directory / "runner.py"
    child = f"import time; from pathlib import Path; time.sleep(2); Path({str(marker)!r}).write_text('orphan')"
    runner.write_text(
        "import subprocess,sys,time\n"
        f"subprocess.Popen([sys.executable, '-c', {child!r}])\n"
        "time.sleep(10)\n"
    )
    store = BusinessStore(directory / "opportunities.db")
    task = store.start("job", "scan", "{}")
    with patch("workflow.career_ops.ATTEMPT_SECONDS", 1), patch.dict(
        os.environ, {"CAREER_OPS_MODEL_RUNNER": f"{sys.executable} {runner}"}
    ):
        try:
            Runtime(store, directory).run_model("evaluate", {}, {"task_id": task["task_id"]})
        except TimeoutError as error:
            assert str(error) == "time_budget_exhausted"
        else:
            raise AssertionError("Model process did not time out")
    time.sleep(2.2)
    assert not marker.exists(), "A timed-out model left a running descendant"
    store.close()

print("workflow process timeout: descendant cleanup passed")
