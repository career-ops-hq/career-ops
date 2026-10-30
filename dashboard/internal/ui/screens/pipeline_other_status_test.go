package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func otherStatusApps() []model.CareerApplication {
	return []model.CareerApplication{
		{Company: "Northwind", Role: "Designer", Status: "Evaluated", Score: 4, HasScore: true},
		{Company: "Contoso", Role: "Designer", Status: "Paused", Score: 3, HasScore: true},
		{Company: "Fabrikam", Role: "Designer", Status: "hold", Score: 3.5, HasScore: true},
	}
}

func TestUnknownStatusGetsItsOwnTabAndMetric(t *testing.T) {
	apps := otherStatusApps()
	m := NewPipelineModel(theme.NewTheme(""), apps, data.ComputeMetrics(apps), t.TempDir(), 140, 40)

	tabs := ansi.Strip(m.renderTabs())
	if !strings.Contains(tabs, "OTHER (1)") {
		t.Fatalf("tabs = %q, want OTHER (1) for the status the canonical list does not name", tabs)
	}
	metricsLine := ansi.Strip(m.renderMetrics())
	if !strings.Contains(metricsLine, "Other:1") {
		t.Fatalf("metrics = %q, want Other:1", metricsLine)
	}

	m.activeTab = tabIndexForFilter(t, filterEvaluated)
	m.applyFilterAndSort()
	for _, app := range m.filtered {
		if app.Status == "Paused" {
			t.Fatalf("evaluated tab included status %q", app.Status)
		}
	}
	sawHold := false
	for _, app := range m.filtered {
		if app.Company == "Fabrikam" {
			sawHold = true
		}
	}
	if !sawHold {
		t.Fatal("hold is an evaluated alias and left the evaluated tab")
	}

	m.activeTab = tabIndexForFilter(t, filterOther)
	m.applyFilterAndSort()
	if len(m.filtered) != 1 || m.filtered[0].Company != "Contoso" {
		t.Fatalf("other tab = %#v, want only the paused row", m.filtered)
	}
}

func TestCleanTrackerHidesTheOtherTab(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Northwind", Role: "Designer", Status: "Evaluated", Score: 4, HasScore: true},
	}
	m := NewPipelineModel(theme.NewTheme(""), apps, data.ComputeMetrics(apps), t.TempDir(), 140, 40)
	tabs := ansi.Strip(m.renderTabs())
	if strings.Contains(tabs, "OTHER") {
		t.Fatalf("clean tracker showed %q", tabs)
	}
}
