"""Check canonical opportunity resolution and same-role history without model calls."""

from pathlib import Path
import sqlite3
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from career_ops.interviews.context import load_context


with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    data = root / "data"
    data.mkdir()
    db = sqlite3.connect(data / "opportunities.db")
    db.executescript("""
        CREATE TABLE opportunities(id INTEGER PRIMARY KEY,url TEXT,company TEXT,role TEXT,state TEXT);
        CREATE TABLE source_evidence(id INTEGER PRIMARY KEY,opportunity_id INTEGER,source TEXT,payload TEXT,created_at TEXT);
        CREATE TABLE results(result_key TEXT,opportunity_id TEXT,module TEXT,payload TEXT);
        INSERT INTO opportunities VALUES(7,'https://jobs.example/7','Bosch','Agent Developer','evaluated');
        INSERT INTO source_evidence VALUES(1,7,'official','{}','2026-09-24');
        INSERT INTO results VALUES('score-7','7','score','{"outcome":"score"}');
    """)
    db.close()
    for name, content in {
        "cv.md": "Candidate facts", "config/profile.yml": "language:\n  output: zh-CN\n",
        "modes/_profile.md": "Targeting", "modes/_custom.md": "Policy, not a candidate claim",
    }.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    sessions = root / "interview-prep" / "sessions"
    sessions.mkdir(parents=True)
    (sessions / "same.md").write_text("---\ncompany: Bosch\nrole: Agent Developer\ndate: 2026-09-24\n---\nTranscript")
    (sessions / "other.md").write_text("---\ncompany: Other\nrole: Agent Developer\n---\nUnrelated")
    context = load_context(data, "7", input_root=root)
    assert context["opportunity"]["company"] == "Bosch"
    assert context["results"]["score"]["outcome"] == "score"
    assert [Path(item["path"]).name for item in context["sessions"]] == ["same.md"]
    assert "Transcript" in context["sessions"][0]["content"]
    assert context["story_provenance_diagnosis"] == "no-story-bank"
    assert "modes/_custom.md" not in context["candidate_sources"]
    assert "Policy" in context["rules"]
    try:
        load_context(data, "8", input_root=root)
    except ValueError as error:
        assert "Unknown opportunity" in str(error)
    else:
        raise AssertionError("Unknown opportunity was accepted")
    (root / "cv.md").unlink()
    try:
        load_context(data, "7", input_root=root)
    except ValueError as error:
        assert "Candidate source files are incomplete" in str(error)
    else:
        raise AssertionError("Interview generation context accepted missing candidate facts")
print("interview context: canonical job, retained session, source boundary passed")
