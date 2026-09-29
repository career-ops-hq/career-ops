"""Check Python portal validation against the retired Node CLI contract."""

from pathlib import Path
import json
import subprocess
import sys
from tempfile import TemporaryDirectory

import yaml


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow.portal_config import validate_config


CASES = [
    [],
    {"title_filter": {"positive": ["Engineer", "", 42], "negative": ""}},
    {"title_filter_full": {"positve": ["AI"], "positive": []}},
    {"location_filter": {"allow": ["Shanghai", None], "block_hard": ""}},
    {"title_filter": {"positive": ["AI"]}, "content_filter": {
        "positive": [False], "by_title_keyword": {"Data": {"positive": ["ML", None]}, "AI": None}}},
    {"visa_filter": {"enabled": "yes", "require_mention": None,
                     "positive": ["sponsor"], "negative": [3]}},
    {"search_queries": "not an array", "tracked_companies": "not an array"},
    {"tracked_companies": [None, {"name": " "}, {"name": "Acme"}, {"name": " acme "},
                           {"name": "Disabled", "enabled": False, "provider": "not-real"}]},
    {"tracked_companies": [{"name": "Acme", "careers_url": "not a URL",
                            "api": "mailto:jobs@example.com", "provider": "not-real"}]},
    {"tracked_companies": [{"name": "Acme", "provider": "workday", "parser": {
        "command": "", "script": "", "args": "bad", "timeout_ms": 0,
        "max_buffer_bytes": "x"}}]},
    {"tracked_companies": [{"name": "Acme", "provider": "workday",
                            "careers_url": "https://aia.wd3.myworkdayjobs.com/External"}]},
]


def messages(output: str) -> list[str]:
    return [line for line in output.splitlines() if line.startswith(("warning:", "error:"))
            or line.endswith(" warnings")]


expected = json.loads((ROOT / "tests/fixtures/portal-config-node-output.json").read_text())
assert len(expected) == len(CASES)
with TemporaryDirectory() as directory:
    path = Path(directory) / "portals.yml"
    for index, config in enumerate(CASES):
        path.write_text(yaml.safe_dump(config, sort_keys=False))
        python = subprocess.run([sys.executable, "-B", "-m", "workflow.portal_config", "--file", str(path)],
                                cwd=ROOT, capture_output=True, text=True)
        assert (python.returncode == 0) == expected[index]["ok"], (index, python.stdout, python.stderr)
        assert messages(python.stdout) == expected[index]["messages"], (index, messages(python.stdout))

assert validate_config({"title_filter_full": {"positve": ["AI"]}})["errors"][0]["path"] == \
    "title_filter_full.positve"
print("workflow portal config: Node CLI decisions match across 11 cases")
