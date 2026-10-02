"""Check the actual local Python, Node, Hermes, browser and resume prerequisites."""
from __future__ import annotations

import argparse
from importlib.util import find_spec
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import yaml

from career_ops.context import INPUT_ROOT, ROOT


def checks() -> dict[str, bool]:
    profile_path = INPUT_ROOT / "profile.yml"
    profile = yaml.safe_load(profile_path.read_text()) if profile_path.is_file() else {}
    resume = (profile or {}).get("cv", {}).get("reactive_resume", {})
    result = {
        "python": sys.version_info >= (3, 11),
        "python_dependencies": all(find_spec(name) for name in ("langgraph", "langgraph.checkpoint.sqlite", "dotenv", "yaml")),
        "node": bool(shutil.which("node")),
        "hermes": bool(shutil.which("hermes")),
        "hermes_config": (Path.home() / ".hermes/config.yaml").is_file(),
        "profile": profile_path.is_file(),
        "cv": (INPUT_ROOT / "cv.md").is_file(),
        "reactive_resume": bool(resume.get("base_resume_id") and resume.get("api_base_url") and os.environ.get("REACTIVE_RESUME_API_KEY")),
        "browser": False,
    }
    if result["node"]:
        probe = subprocess.run(
            ["node", "--input-type=module", "-e", "import {chromium} from 'playwright'; import {existsSync} from 'node:fs'; process.exit(existsSync(chromium.executablePath()) ? 0 : 1)"],
            cwd=ROOT, capture_output=True, timeout=15,
        )
        result["browser"] = probe.returncode == 0
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = checks()
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        for name, available in result.items():
            print(f'{"OK" if available else "MISSING"} {name}')
    return int(not all(result.values()))
