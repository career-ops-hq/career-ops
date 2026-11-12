package screens

import (
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// The dashboard opens on ALL, and an out-of-range selection falls back to it.
// Both are looked up by filter, so a tab added in front of ALL (#5269) does not
// move the landing tab.
func TestDashboardOpensOnAllTab(t *testing.T) {
	apps := []model.CareerApplication{{Company: "Acme", Role: "PM", Status: "Evaluated", Score: 4, HasScore: true}}
	m := NewPipelineModel(theme.NewTheme(""), apps, model.PipelineMetrics{Total: 1}, t.TempDir(), 120, 40)
	if got := getPipelineTabs()[m.activeTab].filter; got != filterAll {
		t.Fatalf("opening tab = %q, want %q", got, filterAll)
	}

	m.activeTab = len(getPipelineTabs()) + 3
	m.applyFilterAndSort()
	if got := getPipelineTabs()[m.activeTab].filter; got != filterAll {
		t.Fatalf("out-of-range tab fell back to %q, want %q", got, filterAll)
	}
}
