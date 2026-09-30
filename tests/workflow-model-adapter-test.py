"""Verify model response parsing and evidence normalization without model calls."""

import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workflow import model_adapter as adapter


assert adapter.parse_object('Explanation\n```json\n{"ok":true}\n```') == {"ok": True}
with tempfile.TemporaryDirectory() as temporary:
    path = Path(temporary) / "value.json"
    adapter.save(path, {"ok": True})
    assert json.loads(path.read_text()) == {"ok": True}
    assert path.read_text().endswith("\n")

research = {
    "searched_at": "2026-09-20", "queries": ["q"],
    "compensation": {}, "company": {},
    "findings": [
        {"id": "f1", "url": "https://example.com", "status": "retrieved", "quote": "exact source"},
        {"id": "f2", "url": "https://other.com", "status": "search_only", "quote": "snippet"},
    ],
}
messages = [{
    "role": "tool",
    "content": '<untrusted_tool_result source="web_extract">\n'
        + json.dumps({"results": [{"url": "https://example.com", "content": "Exact\nsource"}]})
        + "\n</untrusted_tool_result>",
}]
frozen = adapter.freeze_research(research, messages)
assert frozen["sources"] == [{"id": "web1", "text": "Exact\nsource"}]
assert frozen["research"]["findings"][1]["source"] is None
assert frozen["research"]["findings"][1]["quote"] is None
invalid_status = json.loads(json.dumps(frozen))
invalid_status["research"]["findings"][1]["status"] = "unresolved"
normalized = adapter.normalize_research(invalid_status)
assert normalized["research"]["findings"][1]["status"] == "excluded"
assert "unrecognized access status: unresolved" in normalized["research"]["findings"][1]["limitation"]
assert invalid_status["research"]["findings"][1]["status"] == "unresolved"
missing_url = json.loads(json.dumps(invalid_status))
missing_url["research"]["findings"][1]["url"] = None
assert [item["id"] for item in adapter.normalize_research(missing_url)["research"]["findings"]] == ["f1"]
invalid_citable_url = json.loads(json.dumps(frozen))
invalid_citable_url["research"]["findings"][0]["url"] = None
assert adapter.normalize_research(invalid_citable_url)["research"]["findings"][0]["id"] == "f1"
invalid_query = json.loads(json.dumps(frozen))
invalid_query["research"]["queries"] = ["pay", "company"]
invalid_query["research"]["dimensions"] = {
    name: {"queries": [index], "conclusion": "Original conclusion", "next_step": "Verify"}
    for index, name in enumerate(("compensation", "company"))
}
invalid_query["research"]["dimensions"]["company"]["queries"] = [2]
normalized_query = adapter.normalize_research(invalid_query)["research"]["dimensions"]["company"]
assert normalized_query["queries"] == [1] and normalized_query["conclusion"].startswith("Unknown")
assert invalid_query["research"]["dimensions"]["company"]["queries"] == [2]

responses = iter(({key: value for key, value in research.items() if key != "findings"},
                  {**research, "findings": []}))
attempts = []
original_create_agent = adapter.create_agent


class ResearchAgent:
    def __init__(self):
        self._invoke_tool = lambda *_args, **_kwargs: None
        self.request_overrides = {}

    def run_conversation(self, _prompt):
        attempts.append(True)
        return {"completed": True, "final_response": json.dumps(next(responses)), "messages": []}

    def close(self):
        pass


try:
    adapter.create_agent = lambda **_kwargs: ResearchAgent()
    with tempfile.TemporaryDirectory() as temporary:
        result, _ = adapter.call_agent("research", "research prompt", ["web"], Path(temporary))
    assert len(attempts) == 2
    assert result["research"]["findings"] == []
finally:
    adapter.create_agent = original_create_agent

scan_attempts = []
scan_responses = iter(({"jobs": []}, {"complete_jd": False, **dict.fromkeys((
    "company", "role", "liveness", "liveness_reason", "assessment_complete",
    "location", "employment", "compensation", "company_size", "years",
    "core_capabilities", "credentials",
))}))

class ScanAgent(ResearchAgent):
    def run_conversation(self, _prompt):
        scan_attempts.append(True)
        return {"completed": True, "final_response": json.dumps(next(scan_responses)), "messages": []}

try:
    adapter.create_agent = lambda **_kwargs: ScanAgent()
    with tempfile.TemporaryDirectory() as temporary:
        result, _ = adapter.call_agent("scan_evidence", "scan prompt", [], Path(temporary))
    assert len(scan_attempts) == 2
    assert result["complete_jd"] is False
finally:
    adapter.create_agent = original_create_agent

class ToolAgent:
    def __init__(self):
        self._invoke_tool = lambda *_args, **_kwargs: "ok"


usage = {}
tool_agent = ToolAgent()
adapter.limit_research(tool_agent, usage)
for _ in range(5):
    assert tool_agent._invoke_tool("web_search", {}) == "ok"
assert tool_agent._invoke_tool("web_search", {}) != "ok"
assert tool_agent._invoke_tool("web_extract", {"urls": ["a", "b", "c", "d"]}) == "ok"
assert usage == {"tool_calls": 6}

for years, expected in [(0, None), (None, None), (3, 3), (False, False)]:
    evidence = adapter.attach_evidence({
        **dict.fromkeys((
            "company", "role", "complete_jd", "liveness", "liveness_reason",
            "assessment_complete", "core_capabilities", "credentials", "location",
            "employment", "compensation", "company_size",
        )),
        "years": {"verified": years},
    }, {"text": "Original JD"})
    assert evidence["prescreen"]["years"]["verified"] == expected
    assert evidence["jd"] == "Original JD"

print("workflow model adapter: parsing and evidence normalization passed")
