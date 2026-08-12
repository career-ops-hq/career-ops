package data

import (
	"os"
	"path/filepath"
	"testing"
)

// A tracker row with no evaluation carries a sentinel in the Score column
// (— / N/A / -). Parsing must leave HasScore false so the UI can print the
// sentinel instead of "0.0", which reads as an awful fit rather than an
// absent one.
func TestScoreSentinelLeavesHasScoreFalse(t *testing.T) {
	dir := t.TempDir()
	tracker := filepath.Join(dir, "applications.md")

	const content = `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |
|---|------|---------|------|----------|-------|--------|-----|--------|-------|
| 1 | 2026-08-11 | Scored | Senior QA Engineer | Berlin, DE | 4.2/5 | Evaluated | — | — | has a score |
| 2 | 2026-08-11 | EmDash | Software Test Engineer | Munich, DE | — | Evaluated | — | — | no evaluation |
| 3 | 2026-08-11 | NotAvail | QA Lead | Dublin, IE | N/A | Evaluated | — | — | no evaluation |
| 4 | 2026-08-11 | Hyphen | SDET | Madrid, ES | - | Evaluated | — | — | no evaluation |
`
	if err := os.WriteFile(tracker, []byte(content), 0o644); err != nil {
		t.Fatalf("write tracker: %v", err)
	}

	apps := ParseApplications(dir)
	if len(apps) != 4 {
		t.Fatalf("expected 4 rows, got %d", len(apps))
	}

	byCompany := map[string]bool{}
	scores := map[string]float64{}
	for _, a := range apps {
		byCompany[a.Company] = a.HasScore
		scores[a.Company] = a.Score
	}

	if !byCompany["Scored"] {
		t.Errorf("Scored: HasScore = false, want true")
	}
	if got := scores["Scored"]; got != 4.2 {
		t.Errorf("Scored: Score = %v, want 4.2", got)
	}

	for _, company := range []string{"EmDash", "NotAvail", "Hyphen"} {
		if byCompany[company] {
			t.Errorf("%s: HasScore = true, want false (sentinel means not evaluated)", company)
		}
		if got := scores[company]; got != 0 {
			t.Errorf("%s: Score = %v, want 0", company, got)
		}
	}
}
