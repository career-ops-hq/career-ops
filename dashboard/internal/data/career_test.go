package data

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseApplicationsUsesTrackerNumberColumn(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("failed to create data dir: %v", err)
	}

	applications := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 140 | 2026-04-16 | Arize AI | AI Engineer, Instrumentation | 4.7/5 | Evaluated | ✅ | [140](reports/140-arize-ai-engineer-instrumentation-2026-04-16.md) | Strong fit |
| 143 | 2026-04-16 | Arize AI | AI Sales Engineer, US | 4.1/5 | Evaluated | ❌ | [143](reports/143-arize-ai-sales-engineer-us-2026-04-16.md) | Good fit |
`

	applicationsPath := filepath.Join(dataDir, "applications.md")
	if err := os.WriteFile(applicationsPath, []byte(applications), 0o644); err != nil {
		t.Fatalf("failed to write applications tracker: %v", err)
	}

	apps := ParseApplications(tempDir)
	if len(apps) != 2 {
		t.Fatalf("expected 2 parsed applications, got %d", len(apps))
	}

	if apps[0].Number != 140 {
		t.Fatalf("expected first application number to be 140, got %d", apps[0].Number)
	}
	if apps[1].Number != 143 {
		t.Fatalf("expected second application number to be 143, got %d", apps[1].Number)
	}
	if apps[0].ReportNumber != "140" || apps[1].ReportNumber != "143" {
		t.Fatalf("expected report numbers to stay aligned with tracker IDs, got %q and %q", apps[0].ReportNumber, apps[1].ReportNumber)
	}
}
