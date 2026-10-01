"""Run the configured Hermes search tool without a model or workflow state changes."""

import contextlib
import json
from pathlib import Path
import sys


def main() -> None:
    request = json.load(sys.stdin)
    query = request.get("query")
    if not isinstance(query, str) or not query.strip():
        raise ValueError("Search query must be a non-empty string")
    sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
    with contextlib.redirect_stdout(sys.stderr):
        from hermes_cli.env_loader import load_hermes_dotenv
        load_hermes_dotenv()
        from tools.web_tools import web_search_tool
        result = json.loads(web_search_tool(query, limit=20))
    if result.get("success") is not True or not isinstance(result.get("data", {}).get("web"), list):
        raise RuntimeError(result.get("error") or "Search returned invalid results")
    json.dump(result["data"]["web"], sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
