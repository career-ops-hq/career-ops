"""Check the Python replacements for the retained interview evidence CLIs."""

import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[2]


def run(*args: object) -> str:
    result = subprocess.run(
        [sys.executable, "-B", "-m", "career_ops", "interview", *(str(arg) for arg in args)],
        cwd=ROOT, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


with tempfile.TemporaryDirectory() as temporary:
    directory = Path(temporary)
    bank = directory / "stories.md"
    cv = directory / "cv.md"
    jd = directory / "jd.md"
    output = directory / "plan.json"
    bank.write_text("### [Engineering] Python Delivery\n**Action:** Led a 15-person Python team.\n**Result:** Delivered service.\n**Best for questions about:** Python, leadership\n")
    cv.write_text("# Skills\nPython\n\n## Experience\nLed a cross-functional team.\n")
    jd.write_text("## Requirements\n- Python and FastAPI\n")
    assert "Python Delivery" in run("match-star", "Tell me about Python leadership", "--story-bank", bank, "--jd", jd)
    assert "Match 1 of 1" in run("match-star", "Python", "--story-bank", bank, "--top", "0")
    assert "Match 1 of 1" in run("match-star", "Python", "--story-bank", bank, "--top", "invalid")
    assert "Python Delivery" in run("match-star", "--story-bank", bank, "--list")
    provenance = json.loads(run("story-provenance", "--story-bank", bank, "--cv", cv))
    assert provenance["supportedByResume"] and provenance["lowConfidence"] is None
    missing = json.loads(run("story-provenance", "--story-bank", directory / "missing.md", "--cv", cv))
    assert missing["lowConfidence"] == {
        "reason": "no-story-bank", "message": f"{directory / 'missing.md'} not found — nothing was checked.",
    }
    assert "supportedByResume" in run("story-provenance", "--story-bank", bank, "--cv", cv, "--summary")
    gaps = json.loads(run("jd-skill-gap", "--jd", jd, "--cv", cv))
    assert "Python" in gaps["existing"] and "FastAPI" in gaps["gap"]
    plan = json.loads(run("preparation-plan", "--jd", jd, "--company", "Acme", "--role", "Engineer",
                          "--cv", cv, "--output", output))
    assert plan == json.loads(output.read_text()) and plan["schema"] == "career-ops/preparation-plan"
    (directory / "config").mkdir()
    (directory / "modes").mkdir()
    (directory / "profile.yml").write_text("language:\n  output: zh-CN\n")
    (directory / "targeting.md").write_text("Candidate scope")
    (directory / "cv.md").write_text("Candidate facts")
    db = directory / "opportunities.db"
    connection = sqlite3.connect(db)
    connection.executescript("""
        CREATE TABLE opportunities(id INTEGER PRIMARY KEY,url TEXT,company TEXT,role TEXT,source TEXT,state TEXT,application_state TEXT);
        INSERT INTO opportunities VALUES(7,'https://jobs.example/7','Acme','Engineer','official','discovered','none');
    """)
    connection.close()
    resolved = json.loads(run("context", "7", "--db", db, "--input-root", directory))
    assert set(resolved) == {"opportunity", "evaluation", "artifacts", "application", "candidateFacts", "sessions"}
    assert resolved["opportunity"] == {
        "id": 7, "url": "https://jobs.example/7", "company": "Acme", "role": "Engineer",
        "source": "official", "state": "discovered", "applicationState": "none", "evidence": [],
    }
    (directory / "cv.md").unlink()
    (directory / "profile.yml").unlink()
    (directory / "targeting.md").unlink()
    assert json.loads(run("context", "7", "--db", db, "--input-root", directory)) == resolved
print("interview tools: context-independent evidence commands passed")
