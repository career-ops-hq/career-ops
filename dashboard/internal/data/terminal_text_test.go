package data

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseApplicationsStripsTerminalControlsFromCells(t *testing.T) {
	company := "Fernhollow" + string(rune(0x1b)) + "[2JLabs"
	rawCSI := "A" + "\x9b" + "B"
	// U+009B as valid UTF-8. The raw byte above becomes U+FFFD on decode, so
	// only this row shows that a real C1 control is removed.
	c1CSI := "C\u009bD"
	body := "# Applications Tracker\n\n" +
		"| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n" +
		"|---|---|---|---|---|---|---|---|---|\n" +
		"| 1 | 2026-08-01 | " + company + " | Platform Engineer | 4.2/5 | Evaluated | | | remote\trole |\n" +
		"| 2 | 2026-08-02 | " + rawCSI + " | Analyst | 3.0/5 | Applied | | | |\n" +
		"| 3 | 2026-08-03 | " + c1CSI + " | Analyst | 3.0/5 | Applied | | | |\n"
	tempDir, _ := writeTracker(t, body)

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 3 {
		t.Fatalf("expected 3 applications, got %d", len(apps))
	}
	if strings.Contains(apps[0].Company, "\x1b") || apps[0].Company != "Fernhollow[2JLabs" {
		t.Fatalf("company = %q, want the text with the escape removed", apps[0].Company)
	}
	if strings.Contains(apps[0].Notes, "\t") || apps[0].Notes != "remote role" {
		t.Fatalf("notes = %q, want the tab folded to a space", apps[0].Notes)
	}
	for i := 0; i < len(apps[1].Company); i++ {
		if apps[1].Company[i] == 0x1b || apps[1].Company[i] == 0x9b {
			t.Fatalf("company kept byte %#x in %q", apps[1].Company[i], apps[1].Company)
		}
	}
	if apps[2].Company != "CD" {
		t.Fatalf("company = %q, want the U+009B control removed", apps[2].Company)
	}
}

func TestLoadReportSummaryStripsTerminalControls(t *testing.T) {
	root := t.TempDir()
	reports := filepath.Join(root, "reports")
	if err := os.MkdirAll(reports, 0o755); err != nil {
		t.Fatal(err)
	}
	body := "**Archetype:** Eng" + string(rune(0x1b)) + "[2Jineer\n" +
		"**TL;DR:** A fictional" + string(rune(0x1b)) + "[2J row\n"
	if err := os.WriteFile(filepath.Join(reports, "001.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	archetype, tldr, _, _ := LoadReportSummary(root, "reports/001.md")
	if strings.Contains(archetype, "\x1b") || archetype != "Eng[2Jineer" {
		t.Fatalf("archetype = %q", archetype)
	}
	if strings.Contains(tldr, "\x1b") || !strings.Contains(tldr, "fictional") {
		t.Fatalf("tldr = %q", tldr)
	}
}
