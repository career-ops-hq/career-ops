"""Keep direct Python CLI environment loading equivalent to the former Node scan entry."""

import os
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from career_ops.context import load_project_environment


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    (root / ".env").write_text("CAREER_OPS_ALLOW_FAKE_IP_RANGE=1\n")
    with patch.dict(os.environ, {"CAREER_OPS_ALLOW_FAKE_IP_RANGE": "0"}):
        load_project_environment(root)
        assert os.environ["CAREER_OPS_ALLOW_FAKE_IP_RANGE"] == "0"
    with patch.dict(os.environ, {}, clear=True):
        load_project_environment(root)
        assert os.environ["CAREER_OPS_ALLOW_FAKE_IP_RANGE"] == "1"

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    shutil.copytree(ROOT / "career_ops", root / "career_ops", ignore=shutil.ignore_patterns("__pycache__"))
    configured, inherited = root / "configured", root / "inherited"
    configured.mkdir()
    inherited.mkdir()
    (configured / "cv.md").write_text("# Skills\nPython\n")
    (inherited / "cv.md").write_text("# Skills\nRust\n")
    (root / ".env").write_text(f"CAREER_OPS_INPUT_ROOT={configured}\n")
    jd = root / "jd.md"
    jd.write_text("## Requirements\n- Python\n")
    env = {key: value for key, value in os.environ.items() if key != "CAREER_OPS_INPUT_ROOT"}
    command = [sys.executable, "-B", "-m", "career_ops", "interview", "jd-skill-gap", "--jd", str(jd)]
    result = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True, check=True)
    assert json.loads(result.stdout)["existing"] == ["Python"]
    result = subprocess.run(command, cwd=root, env={**env, "CAREER_OPS_INPUT_ROOT": str(inherited)}, capture_output=True, text=True, check=True)
    assert json.loads(result.stdout)["gap"] == ["Python"]
