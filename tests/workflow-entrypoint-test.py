"""Exercise global directory routing and the read-only runtime doctor."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as temporary:
    for prefix in (("--directory", temporary), (f"--directory={temporary}",)):
        for command in (("cv", "--help"), ("portal", "validate", "--help"),
                        ("interview", "start", "--help"), ("cv", "check", "--help")):
            result = subprocess.run([sys.executable, "-B", "-m", "career_ops", *prefix, *command],
                                    cwd=ROOT, capture_output=True, text=True)
            assert result.returncode == 0, result.stderr
            assert "usage:" in result.stdout
    result = subprocess.run([sys.executable, "-B", "-m", "career_ops", "doctor", "--json"],
                            cwd=ROOT, capture_output=True, text=True, check=True)
    checks = json.loads(result.stdout)
    assert isinstance(checks, dict) and checks
    assert not list(Path(temporary).iterdir()), "Read-only command routing must not create business records"
