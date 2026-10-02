"""Check targeted JD classification and recurring evaluated gap strategy."""

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from career_ops.insights.upskill import targeted_skill_gap, upskill_view


jd = "## Requirements\n- Python and Kubernetes\n- Terraform and Java\n## Benefits\n- Docker\n"
cv = "## Skills\n- Python, k8s\n## Experience\nUsed Java in a project.\n"
targeted = targeted_skill_gap(jd, cv)
assert targeted["existing"] == ["Python", "Kubernetes"]
assert targeted["supportedByResume"] == ["Java"]
assert targeted["gap"] == ["Terraform"]
assert targeted_skill_gap("No headings", cv)["reason"] == "no-requirements-section"
assert targeted_skill_gap("## Requirements\n- Communication", cv)["reason"] == "no-skill-candidates"
assert targeted_skill_gap("No headings", cv)["lowConfidence"]["message"].startswith("No requirements section")
assert targeted["lowConfidence"] is None
nested_cv = ("## Skills\n### Production engineering\nPython\n"
             "### Prototypes and personal workflows\nTerraform\n"
             "### In progress\nKubernetes\n## Experience\n")
nested = targeted_skill_gap(jd, nested_cv)
assert nested["existing"] == ["Python"]
assert nested["supportedByResume"] == ["Terraform"]
assert nested["gap"] == ["Kubernetes", "Java"]

with tempfile.TemporaryDirectory() as temp:
    cv_path = Path(temp) / "cv.md"
    cv_path.write_text("## Skills\nPython\n## Experience\nI once mentioned Terraform but it is unverified.\n")
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    assert upskill_view(db, cv_path)["status"] == "source_missing"
    db.execute("CREATE TABLE results(opportunity_id TEXT,module TEXT,payload TEXT)")
    for index in range(5):
        report = ("## B. 能力竞争力\n\n| 职责/资格 | 判定 | 候选证据 |\n|---|---|---|\n"
                  "| Terraform 平台交付 | Gap | 未证实 |\n"
                  "| 企业架构路线图 | Gap | 未证实 |\n"
                  "| Python 开发 | Proven | 已证实 |\n\n## C. 入职吸引力\n")
        db.execute("INSERT INTO results VALUES(?,?,?)", (str(index), "score", json.dumps({
            "outcome": "score", "artifact": {"report": report}
        })))
    db.execute("INSERT INTO results VALUES(?,?,?)", ("bad", "score", json.dumps({
        "outcome": "score", "artifact": {"report": "No capability table"}
    })))
    result = upskill_view(db, cv_path)
    assert result["status"] == "observed" and result["reports"] == 5
    assert result["unparsed_reports"] == 1
    assert result["gaps"][0]["skill"] == "Terraform"
    assert result["gaps"][0]["tier"] == "Critical"
    assert any(topic["topic"] == "企业架构路线图" for topic in result["topics"])
    assert all(gap["skill"] != "Python" for gap in result["gaps"])
    assert upskill_view(db, cv_path, min_reports=6)["status"] == "insufficient_data"
    db.close()
