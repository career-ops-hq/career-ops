"""Check retained Node JD extraction, aliases and low-confidence diagnostics."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workflow.jd_skill_gap import classify_skill_gaps, diagnose_extraction, scan_jd
from workflow.skill_extract import canonicalize, extract_skills


jd = "# Role\n## Requirements\n- Python, Kubernetes, Rust\n## Benefits\n- 401k, Equity\n"
skills, seen = scan_jd(jd)
assert seen and skills == ["Python", "Kubernetes", "Rust"]
cv = "# Skills\nPython, k8s\n# Experience\nBuilt Rust services.\n"
assert classify_skill_gaps(skills, cv) == {"existing": ["Python", "Kubernetes"], "supportedByResume": ["Rust"], "gap": []}
assert diagnose_extraction("", []) == "empty-jd"
assert diagnose_extraction("No requirements listed", []) == "no-requirements-section"
assert diagnose_extraction("## Requirements\n- lowercase python", []) == "no-skill-candidates"
for heading in ("YOU HAVE:", "You'll have:", "You Will Have:",
                "You Might Be a Good Fit If You:", "## It's Important To Us That You Have",
                "What we're looking for", "Who you are"):
    assert "React" in scan_jd(f"# Role\n{heading}\n- Experience with React\n")[0], heading
assert scan_jd("# Role\nYOU WILL\n- Ship Kubernetes manifests\n")[0] == []
assert scan_jd("# Role\nYOU HAVE:\n- Python\nYOU WILL\n- Ship Kubernetes manifests\n")[0] == ["Python"]
assert scan_jd("##### Requirements\n- Python\n###### Benefits\n- Equity\n")[0] == ["Python"]
assert scan_jd("## Requirements\r\n- C#, C++ or F#\r\n- Docker.\r\n")[0] == ["C#", "C++", "F#", "Docker"]
deep_cv = "##### Skills\nPython\n###### Experience\nDeployed Kubernetes clusters\n"
assert classify_skill_gaps(["Python", "Kubernetes"], deep_cv) == {
    "existing": ["Python"], "supportedByResume": ["Kubernetes"], "gap": [],
}
assert canonicalize("cloud") == "cloud"
assert canonicalize("k8s") == "Kubernetes"
assert "Go" in extract_skills("Go, Rust") and "Go" not in extract_skills("go to market")
assert "SAFe" in extract_skills("SAFe 6") and "SAFe" not in extract_skills("a safe environment")
assert extract_skills("Certified Scrum Master") == {"Certified ScrumMaster"}
assert {"C++", "C#", ".NET", "SQL"} <= extract_skills("Requires C++ and C# on .NET, plus SQL.")
assert {"GraphQL", "PyTorch", "PostgreSQL"} <= extract_skills("graphql, pytorch and postgresql")
assert "JavaScript" not in extract_skills("Expert in Java and AWS.")
assert "Go" not in extract_skills("Go-to-market and Go-live; ready to GO live")
assert extract_skills("Lean Six Sigma Black Belt") & {"Lean Six Sigma", "Six Sigma"} == {"Lean Six Sigma"}
assert "SAFe" not in extract_skills("SAFety training and a safe environment")
assert canonicalize("safe") == "safe" and canonicalize("SAFe") == "SAFe"
assert not extract_skills("CSM required.")
assert extract_skills("") == set() and extract_skills(None) == set()
for alias, expected in (
    ("pmp", "PMP"), ("pmi-acp", "PMI-ACP"), ("pgmp", "PgMP"), ("capm", "CAPM"),
    ("pmbok", "PMBOK"), ("prince2", "PRINCE2"), ("certified scrummaster", "Certified ScrumMaster"),
    ("cspo", "CSPO"), ("itil", "ITIL"), ("cobit", "COBIT"), ("togaf", "TOGAF"),
    ("lean six sigma", "Lean Six Sigma"), ("six sigma", "Six Sigma"), ("cissp", "CISSP"),
    ("cism", "CISM"), ("cipp", "CIPP"), ("certified scrum master", "Certified ScrumMaster"),
    ("certified scrum product owner", "CSPO"), ("pmi acp", "PMI-ACP"), ("prince 2", "PRINCE2"),
    ("lean six-sigma", "Lean Six Sigma"), ("six-sigma", "Six Sigma"),
):
    assert canonicalize(alias) == expected
    assert expected in extract_skills(f"Requires {alias} certification")
print("JD skill gap: section scan, CV evidence, aliases and diagnostics passed")
