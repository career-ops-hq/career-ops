"""Keep direct Python CLI environment loading equivalent to the former Node scan entry."""

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.career_ops import load_project_environment


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    (root / ".env").write_text("CAREER_OPS_ALLOW_FAKE_IP_RANGE=1\n")
    with patch.dict(os.environ, {"CAREER_OPS_ALLOW_FAKE_IP_RANGE": "0"}):
        load_project_environment(root)
        assert os.environ["CAREER_OPS_ALLOW_FAKE_IP_RANGE"] == "0"
    with patch.dict(os.environ, {}, clear=True):
        load_project_environment(root)
        assert os.environ["CAREER_OPS_ALLOW_FAKE_IP_RANGE"] == "1"
