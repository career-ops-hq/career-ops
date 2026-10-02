"""Verify Python discovery commands reject bad flags before collecting jobs."""

import json
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
PYTHON = ROOT / ".venv" / "bin" / "python"


with tempfile.TemporaryDirectory(prefix="career-ops-discovery-cli-") as temporary:
    directory = Path(temporary)
    missing = directory / "missing.yml"
    environment = {**os.environ, "CAREER_OPS_INPUT_ROOT": str(directory), "CAREER_OPS_PORTALS": str(missing)}

    def run(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [str(PYTHON), "-B", "-m", "career_ops", "--directory", str(directory / "data"), *args],
            cwd=ROOT, env=environment, text=True, capture_output=True, timeout=30,
        )

    for command in (("discover",), ("discover", "global")):
        result = run(*command, "--help")
        assert result.returncode == 0 and "usage:" in result.stdout.lower()
        assert not (directory / "data" / "opportunities.db").exists()

    for arguments, expected in (
        (("discover", "--bogus"), "unrecognized arguments"),
        (("discover", "--company"), "expected one argument"),
        (("discover", "--posted-after=not-a-date"), "--posted-after expects YYYY-MM-DD"),
        (("discover", "--posted-before", "not-a-date"), "--posted-before expects YYYY-MM-DD"),
    ):
        result = run(*arguments)
        assert result.returncode != 0 and expected in result.stderr, (arguments, result.stderr)
        assert not (directory / "data" / "opportunities.db").exists()

    result = run("discover", "--posted-after=2026-07-28")
    assert result.returncode != 0 and "Portal configuration is missing" in result.stderr

    portals = directory / "portals.yml"
    portals.write_text("{}\n")
    environment["CAREER_OPS_PORTALS"] = str(portals)
    result = run("discover", "global", "--ats=,")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["sources"] == []
    assert (directory / "data" / "opportunities.db").is_file()

print("workflow discovery CLI: safe flag handling and Python global entry passed")
