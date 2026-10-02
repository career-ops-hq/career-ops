"""Check the retained Node story-provenance and ranking invariants in Python."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from career_ops.interviews.evidence import classify_numeric_claims, format_ats, match_stories, provenance_diagnosis, stories, tokens


cv = """Reduced onboarding ramp time from 8 hours to 2 hours per cohort.
Led a cross-functional team through an LMS migration with zero data loss.
Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
Brings 15 years of unrelated adult education experience.
"""
bank = """### [Automation] Onboarding Workflow
**Action:** Built an automated workflow.
**Result:** Ramp time dropped from 8 hours to 2 hours per cohort.
**Best for questions about:** automation, process improvement

### [Leadership] LMS Migration Team
**Action:** Led a 15-person team through migration.
**Result:** Zero data loss.
**Best for questions about:** leadership, project management

### [Scale] Statewide Rollout
**Action:** Built training modules.
**Result:** 500+ employees completed the rollout.

### [Budget] Vendor Negotiation
**Provenance:** user-cannot-confirm
**Action:** Renegotiated a contract.
**Result:** Estimated 40% savings.

### [Manual] Direct Confirmation
**Provenance:** user-stated 2026-08-10
**Result:** Reached 50 students.
"""
result = classify_numeric_claims(bank, cv)
assert any(item["story"] == "Onboarding Workflow" and item["pattern"] == "hour-range" for item in result["existing"])
assert any(item["story"] == "LMS Migration Team" and item["pattern"] == "scale-hyphen" for item in result["supportedByResume"])
assert next(item for item in result["supportedByResume"] if item["story"] == "LMS Migration Team")["contextWords"]
assert not any(item["story"] == "LMS Migration Team" for item in result["existing"])
assert any(item["story"] == "Statewide Rollout" for item in result["derivedUnverified"])
assert any(item["story"] == "Vendor Negotiation" for item in result["userCannotConfirm"])
assert "durable" in result["userCannotConfirm"][0]["reason"]
assert not any(item["story"] == "Vendor Negotiation" for item in result["existing"])
assert any(item["story"] == "Direct Confirmation" for item in result["existing"])
assert any("Provenance marker" in item.get("reason", "") for item in result["existing"])
overlap = "### [Scale] Certification\n**Provenance:** user-stated 2026-02-01\n**Action:** Trained 275 employees per cohort.\n"
assert any(item["story"] == "Certification" for item in classify_numeric_claims(overlap, cv)["existing"])
assert any(item["story"] == "Certification" for item in classify_numeric_claims(
    overlap.replace("**Provenance:** user-stated 2026-02-01\n", ""), cv,
)["supportedByResume"])
assert any(item["claim"] == "50 students" for item in classify_numeric_claims("### [Scale] 50 students\n**Action:** Coached.\n", cv)["derivedUnverified"])
assert result == classify_numeric_claims(bank, cv)
assert len(stories(bank)) == 4 and len(stories(bank, require_action=False)) == 5
assert stories(bank, require_action=False)[0]["provenance"] is None
assert provenance_diagnosis(False, True, 0, 0) == "no-story-bank"
assert provenance_diagnosis(True, False, 0, 0) == "no-cv"
assert provenance_diagnosis(True, True, 0, 0) == "no-stories-parsed"
assert provenance_diagnosis(True, True, 1, 0) == "no-numeric-claims-found"
assert provenance_diagnosis(True, True, 1, 1) is None
assert match_stories(bank, "Tell me about automation", top=1)[0]["story"]["title"] == "Onboarding Workflow"
assert match_stories(bank, "Describe a delivery", jd="leadership and project management", top=1)[0]["story"]["title"] == "LMS Migration Team"
assert len(match_stories(bank, "Discuss scale", top=2)) == 2
assert [(item["story"]["title"], item["score"]) for item in match_stories(bank, "Tell me about automation", top=2)] == [
    ("Onboarding Workflow", 5), ("LMS Migration Team", 0),
]
assert "Under 250 words" in format_ats(stories(bank)[0])
assert "Under 250 words" not in format_ats({**stories(bank)[0], "action": "word " * 500})
repeated_fields = """### [Scale] Repeated Field
**Provenance:** user-cannot-confirm
**Provenance:** source: cv.md
**Action:** First action.
**Action:** Second action.
**Result:** Reached 50 students.
"""
assert stories(repeated_fields)[0]["action"] == "First action."
assert any(item["story"] == "Repeated Field" for item in classify_numeric_claims(repeated_fields, cv)["userCannotConfirm"])
assert tokens("एआई कार्य") == ["एआई", "कार्य"]
print("interview evidence: story matching and numeric provenance parity passed")
