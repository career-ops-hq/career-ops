package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func testDashboardContext() model.DashboardContext {
	return model.DashboardContext{
		Readiness: []model.DashboardReadinessItem{
			{Label: "CV", Path: "cv.md", Ready: false, Required: true, Hint: "Add a markdown CV"},
			{Label: "Profile", Path: "config/profile.yml", Ready: true, Required: true, Hint: "Fill profile"},
			{Label: "Proof points", Path: "article-digest.md", Ready: false, Required: false, Hint: "Add achievements"},
		},
		RequiredReady:     1,
		RequiredTotal:     2,
		MissingRequired:   1,
		SetupComplete:     false,
		PendingURLs:       2,
		ReportCount:       3,
		ProofPointsStatus: "missing",
		StoryBankStatus:   "ready",
		Metrics: model.PipelineMetrics{
			Total:      4,
			AvgScore:   4.2,
			TopScore:   4.8,
			WithPDF:    2,
			Actionable: 3,
			ByStatus: map[string]int{
				"evaluated": 2,
				"applied":   1,
				"interview": 1,
			},
		},
		NextAction: model.DashboardAction{Title: "Add your CV", Detail: "Career-ops cannot score fit.", Command: "create cv.md"},
		Journey: []model.JourneyStep{
			{Label: "Setup", Status: "active", Detail: "1/2 required files ready"},
			{Label: "Discover", Status: "active", Detail: "2 URLs waiting"},
			{Label: "Shortlist", Status: "active", Detail: "3 active opportunities"},
		},
	}
}

func TestCommandViewRendersReadinessJourneyAndNextAction(t *testing.T) {
	cm := NewCommandModel(theme.NewTheme("catppuccin-mocha"), testDashboardContext(), 100, 36)

	view := cm.View()

	for _, want := range []string{
		"CAREER COMMAND CENTER",
		"Add your CV",
		"Career-ops cannot score fit.",
		"Setup",
		"Discover",
		"CV",
		"Proof points",
		"p pipeline",
		"a analytics",
	} {
		if !strings.Contains(view, want) {
			t.Fatalf("expected command view to contain %q, got:\n%s", want, view)
		}
	}
}

func TestCommandKeyboardNavigationMessages(t *testing.T) {
	cm := NewCommandModel(theme.NewTheme("catppuccin-mocha"), testDashboardContext(), 100, 36)

	_, cmd := cm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}})
	if cmd == nil {
		t.Fatal("expected p to emit command")
	}
	if _, ok := cmd().(CommandOpenPipelineMsg); !ok {
		t.Fatalf("expected p to emit CommandOpenPipelineMsg")
	}

	_, cmd = cm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	if cmd == nil {
		t.Fatal("expected a to emit command")
	}
	if _, ok := cmd().(CommandOpenProgressMsg); !ok {
		t.Fatalf("expected a to emit CommandOpenProgressMsg")
	}

	_, cmd = cm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	if cmd == nil {
		t.Fatal("expected q to emit command")
	}
	if _, ok := cmd().(CommandClosedMsg); !ok {
		t.Fatalf("expected q to emit CommandClosedMsg")
	}
}
