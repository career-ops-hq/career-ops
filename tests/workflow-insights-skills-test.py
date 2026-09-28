"""Check canonical skill recognition and false positive guards."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from workflow.insights.skills import canonicalize, extract_skills


assert extract_skills("Needs k8s, golang and Postgres; NodeJS a plus") == {
    "Kubernetes", "Go", "PostgreSQL", "Node.js"
}
assert extract_skills("C++ and C# on .NET, plus SQL") == {"C++", "C#", ".NET", "SQL"}
assert extract_skills("go the extra mile; safe environment; Customer Success Manager (CSM)") == set()
assert extract_skills("Go/Rust and SAFe 6, Certified Scrum Master") == {
    "Go", "Rust", "SAFe", "Certified ScrumMaster"
}
assert extract_skills("Go-to-market and GO live") == set()
assert extract_skills("Python经验、SQL能力") == {"Python", "SQL"}
assert canonicalize("cloud") == "cloud"
assert canonicalize("graphql") == "GraphQL"
