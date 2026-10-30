package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

func newStatusTestModel(t *testing.T) (appModel, model.CareerApplication) {
	t.Helper()
	root := t.TempDir()
	// An explicit missing tracker forces a real writer failure without touching
	// the checkout's tracker or relying on permissions (which differ as root).
	t.Setenv("CAREER_OPS_TRACKER", filepath.Join(root, "tracker.md"))
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	app := model.CareerApplication{
		Number: 7, ReportNumber: "7", Company: "Example Co", Role: "Engineer", Status: "Applied",
	}
	theme := theme.NewTheme("catppuccin-mocha")
	return appModel{
		careerOpsPath: root,
		theme:         theme,
		pipeline: screens.NewPipelineModel(theme, []model.CareerApplication{app},
			model.PipelineMetrics{Total: 1}, root, 120, 40),
		viewer: screens.NewViewerModel(theme, root, filepath.Join(root, "report.md"),
			"Example report", 120, 40, app),
	}, app
}

func TestPipelineStatusWriteFailureIsVisible(t *testing.T) {
	for _, withNotes := range []bool{false, true} {
		name := "status"
		if withNotes {
			name = "status-and-notes"
		}
		t.Run(name, func(t *testing.T) {
			m, app := newStatusTestModel(t)
			var msg tea.Msg = screens.PipelineUpdateStatusMsg{
				CareerOpsPath: m.careerOpsPath, App: app, NewStatus: "Hired",
			}
			if withNotes {
				msg = screens.PipelineUpdateStatusAndNotesMsg{
					CareerOpsPath: m.careerOpsPath, App: app, NewStatus: "Discarded",
					NotesAppend: "DISCARD: salary_too_low",
				}
			}
			updated, _ := m.Update(msg)
			view := updated.View()
			if !strings.Contains(view, "Could not update status:") {
				t.Fatalf("writer failure must be visible in the dashboard, got %q", view)
			}
			if strings.Contains(view, "CONGRATULATIONS") {
				t.Fatal("a failed status write must not start the hired celebration")
			}
		})
	}
}

func TestViewerStatusWriteFailurePreservesStatus(t *testing.T) {
	for _, status := range []string{"Interview", "Hired"} {
		t.Run(status, func(t *testing.T) {
			m, app := newStatusTestModel(t)
			m.state = viewReport
			updated, _ := m.Update(screens.ViewerUpdateStatusMsg{App: app, NewStatus: status})
			failed := updated.(appModel)
			if failed.state != viewReport {
				t.Fatal("failed viewer update must remain in the viewer")
			}
			if !strings.Contains(failed.View(), "Could not update status:") {
				t.Fatalf("writer failure must be visible in the viewer, got %q", failed.View())
			}
			// The picker leads with the application's current status. Reopening
			// and confirming it must still select the previously saved state.
			viewer, _ := failed.viewer.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}})
			_, cmd := viewer.Update(tea.KeyMsg{Type: tea.KeyEnter})
			if cmd == nil {
				t.Fatal("expected a status selection command")
			}
			selection := cmd().(screens.ViewerUpdateStatusMsg)
			if selection.NewStatus != app.Status || selection.App.Status != app.Status {
				t.Fatalf("failed write changed viewer state: %+v", selection)
			}
		})
	}
}

func TestSuccessfulHiredWriteStartsCelebration(t *testing.T) {
	for _, state := range []viewState{viewPipeline, viewReport} {
		name := "pipeline"
		if state == viewReport {
			name = "viewer"
		}
		t.Run(name, func(t *testing.T) {
			m, app := newStatusTestModel(t)
			m.state = state
			tracker := os.Getenv("CAREER_OPS_TRACKER")
			content := "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n" +
				"|---|---|---|---|---|---|---|---|---|\n" +
				"| 7 | 2026-09-01 | Example Co | Engineer | 4.2/5 | Applied | ❌ | [7](reports/007.md) | |\n"
			if err := os.WriteFile(tracker, []byte(content), 0o644); err != nil {
				t.Fatal(err)
			}
			var msg tea.Msg = screens.PipelineUpdateStatusMsg{
				CareerOpsPath: m.careerOpsPath, App: app, NewStatus: "Hired",
			}
			if state == viewReport {
				msg = screens.ViewerUpdateStatusMsg{App: app, NewStatus: "Hired"}
			}
			updated, _ := m.Update(msg)
			if !strings.Contains(updated.View(), "CONGRATULATIONS") {
				t.Fatalf("successful hired write must celebrate, got %q", updated.View())
			}
			saved, err := os.ReadFile(tracker)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(saved), "| Hired |") {
				t.Fatalf("celebration appeared without a saved Hired status: %s", saved)
			}
		})
	}
}

func TestViewerSidecarFailureReloadsPersistedStatusWithoutCelebrating(t *testing.T) {
	m, app := newStatusTestModel(t)
	m.state = viewReport
	tracker := os.Getenv("CAREER_OPS_TRACKER")
	content := "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n" +
		"|---|---|---|---|---|---|---|---|---|\n" +
		"| 8 | 2026-09-01 | Other Co | Engineer | 4.2/5 | Offer | ❌ | [8](reports/008.md) | |\n" +
		"| 7 | 2026-09-01 | Example Co | Engineer | 4.2/5 | Applied | ❌ | [7](reports/007.md) | |\n"
	if err := os.WriteFile(tracker, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	// A directory blocks the ledger append after the tracker was committed,
	// independent of the test runner's filesystem permissions.
	if err := os.Mkdir(filepath.Join(filepath.Dir(tracker), "status-log.tsv"), 0o755); err != nil {
		t.Fatal(err)
	}

	updated, _ := m.Update(screens.ViewerUpdateStatusMsg{App: app, NewStatus: "Hired"})
	failed := updated.(appModel)
	if failed.state != viewReport || strings.Contains(failed.View(), "CONGRATULATIONS") {
		t.Fatal("partial success must remain in the viewer without celebrating")
	}
	if !strings.Contains(failed.View(), "status saved, but status-log append failed") {
		t.Fatalf("sidecar failure must stay visible: %q", failed.View())
	}
	viewer, _ := failed.viewer.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}})
	_, cmd := viewer.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("expected a status selection command")
	}
	selection := cmd().(screens.ViewerUpdateStatusMsg)
	if selection.NewStatus != "Hired" || selection.App.Status != "Hired" {
		t.Fatalf("viewer must reflect the target report's persisted status: %+v", selection)
	}
}
