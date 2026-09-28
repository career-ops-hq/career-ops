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
    "compensation": {}, "team": {}, "company": {},
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
