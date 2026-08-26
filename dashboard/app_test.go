package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

func TestNewAppModelStartsCommandCenterWithoutTracker(t *testing.T) {
	m := newAppModel(t.TempDir(), 100, 36)

	if m.state != viewCommand {
		t.Fatalf("expected dashboard to start on command center, got state %d", m.state)
	}
	if m.dashboardContext.NextAction.Title != "Add your CV" {
		t.Fatalf("expected empty workspace to guide CV setup, got %q", m.dashboardContext.NextAction.Title)
	}
	if !strings.Contains(m.View(), "CAREER COMMAND CENTER") {
		t.Fatalf("expected command center view, got:\n%s", m.View())
	}
}

func TestAppModelRoutesCommandCenterMessages(t *testing.T) {
	m := newAppModel(t.TempDir(), 100, 36)

	updated, _ := m.Update(screens.CommandOpenPipelineMsg{})
	pipelineModel := updated.(appModel)
	if pipelineModel.state != viewPipeline {
		t.Fatalf("expected pipeline state after command message, got %d", pipelineModel.state)
	}

	updated, _ = pipelineModel.Update(screens.PipelineOpenHomeMsg{})
	homeModel := updated.(appModel)
	if homeModel.state != viewCommand {
		t.Fatalf("expected home state after pipeline home message, got %d", homeModel.state)
	}

	updated, _ = homeModel.Update(screens.CommandOpenProgressMsg{})
	progressModel := updated.(appModel)
	if progressModel.state != viewProgress {
		t.Fatalf("expected progress state after command message, got %d", progressModel.state)
	}
}

// Regression for the code-owner review on the command-center PR: Stats must be
// populated at construction, not only after the first refresh. Launch -> p -> S
// previously showed all zeros against a populated tracker.
func TestNewAppModelInitializesStatsOnPopulatedRepo(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	tracker := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-03 | Acme | Engineer | 4.0/5 | Evaluated | x | [1](../reports/001-acme-2026-06-03.md) | first |
| 2 | 2026-06-03 | Beta | Engineer | 3.0/5 | Evaluated | x | [2](../reports/002-beta-2026-06-03.md) | second |
`
	if err := os.WriteFile(filepath.Join(dataDir, "applications.md"), []byte(tracker), 0o644); err != nil {
		t.Fatalf("write tracker: %v", err)
	}

	m := newAppModel(tempDir, 100, 36)

	if m.evaluatedCount != 2 {
		t.Fatalf("expected 2 evaluated applications before any refresh, got %d", m.evaluatedCount)
	}
	if len(m.statsMetrics.ScoreTiers) == 0 {
		t.Fatal("expected score tiers to be computed at construction, got zero-value stats")
	}
	if m.statsMetrics.QualityBarPct <= 0 {
		t.Fatalf("expected non-zero quality bar with a 4.0/5 row, got %v", m.statsMetrics.QualityBarPct)
	}
}
