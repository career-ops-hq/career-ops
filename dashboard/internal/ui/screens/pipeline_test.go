package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func tabIndexForFilter(t *testing.T, filter string) int {
	t.Helper()

	for i, tab := range pipelineTabs {
		if tab.filter == filter {
			return i
		}
	}

	t.Fatalf("expected pipeline tabs to include filter %q", filter)
	return -1
}

func TestWithReloadedDataPreservesStateAndSelection(t *testing.T) {
	initialApps := []model.CareerApplication{
		{
			Company:    "Acme",
			Role:       "Backend Engineer",
			Status:     "Evaluated",
			Score:      4.2,
			ReportPath: "reports/001-acme.md",
		},
		{
			Company:    "Beta",
			Role:       "Platform Engineer",
			Status:     "Applied",
			Score:      4.6,
			ReportPath: "reports/002-beta.md",
		},
	}

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		initialApps,
		model.PipelineMetrics{Total: len(initialApps)},
		"..",
		120,
		40,
	)
	pm.sortMode = sortCompany
	pm.activeTab = 0
	pm.viewMode = "flat"
	pm.applyFilterAndSort()
	pm.cursor = 1
	pm.reportCache["reports/002-beta.md"] = reportSummary{tldr: "cached"}

	refreshedApps := []model.CareerApplication{
		initialApps[0],
		initialApps[1],
		{
			Company:    "Gamma",
			Role:       "AI Engineer",
			Status:     "Interview",
			Score:      4.8,
			ReportPath: "reports/003-gamma.md",
		},
	}

	reloaded := pm.WithReloadedData(refreshedApps, model.PipelineMetrics{Total: len(refreshedApps)})

	if reloaded.sortMode != sortCompany {
		t.Fatalf("expected sort mode %q, got %q", sortCompany, reloaded.sortMode)
	}
	if reloaded.viewMode != "flat" {
		t.Fatalf("expected view mode to stay flat, got %q", reloaded.viewMode)
	}
	if got := len(reloaded.filtered); got != 3 {
		t.Fatalf("expected 3 filtered apps after refresh, got %d", got)
	}
	if app, ok := reloaded.CurrentApp(); !ok || app.ReportPath != "reports/002-beta.md" {
		t.Fatalf("expected selection to stay on beta app, got %+v (ok=%v)", app, ok)
	}
	if reloaded.reportCache["reports/002-beta.md"].tldr != "cached" {
		t.Fatal("expected cached report summaries to survive refresh")
	}
}

func TestRenderAppLineIncludesDateColumn(t *testing.T) {
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		nil,
		model.PipelineMetrics{},
		"..",
		120,
		40,
	)

	line := pm.renderAppLine(model.CareerApplication{
		Number:  42,
		Date:    "2026-04-13",
		Company: "Anthropic",
		Role:    "Forward Deployed Engineer",
		Status:  "Applied",
		Score:   4.5,
	}, false)

	if !strings.Contains(line, "2026-04-13") {
		t.Fatalf("expected rendered line to include date column, got %q", line)
	}
	if !strings.Contains(line, "#42") {
		t.Fatalf("expected rendered line to include tracker number marker, got %q", line)
	}
}

func TestSearchFiltersByCompanyRoleAndNotes(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6, Notes: "payments infra"},
		{Company: "Anthropic", Role: "AI Safety Engineer", Status: "Applied", Score: 4.8, Notes: "policy work"},
		{Company: "Acme Corp", Role: "Senior PM, Voice AI", Status: "Evaluated", Score: 4.2, Notes: "Series B in Madrid"},
		{Company: "Globex", Role: "Platform Engineer", Status: "Applied", Score: 3.9, Notes: "remote-first"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.activeTab = tabIndexForFilter(t, filterAll)

	// Match by company substring (case-insensitive).
	pm.searchQuery = "stripe"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Stripe" {
		t.Fatalf("expected 1 match for 'stripe', got %+v", pm.filtered)
	}

	// Match by role substring.
	pm.searchQuery = "voice ai"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Acme Corp" {
		t.Fatalf("expected 1 match for 'voice ai', got %+v", pm.filtered)
	}

	// Match by notes substring.
	pm.searchQuery = "madrid"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Acme Corp" {
		t.Fatalf("expected 1 match for notes 'madrid', got %+v", pm.filtered)
	}

	// Empty query restores everything.
	pm.searchQuery = ""
	pm.applyFilterAndSort()
	if len(pm.filtered) != len(apps) {
		t.Fatalf("expected empty query to restore all rows, got %d/%d", len(pm.filtered), len(apps))
	}
}

func TestSearchComposesWithActiveTab(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
		{Company: "Stripe", Role: "Frontend Engineer", Status: "Applied", Score: 4.5},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Applied", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.activeTab = tabIndexForFilter(t, filterApplied)
	pm.searchQuery = "stripe"
	pm.applyFilterAndSort()

	if len(pm.filtered) != 1 || pm.filtered[0].Role != "Frontend Engineer" {
		t.Fatalf("expected applied+stripe to leave only Frontend Engineer, got %+v", pm.filtered)
	}
}

func TestSearchIsCaseInsensitive(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	for _, q := range []string{"anthropic", "ANTHROPIC", "AnThRoPiC"} {
		pm.searchQuery = q
		pm.applyFilterAndSort()
		if len(pm.filtered) != 1 {
			t.Fatalf("expected case-insensitive match for %q, got %d rows", q, len(pm.filtered))
		}
	}
}

func TestSearchEnterCommitsAndEscClearsCommittedQuery(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)

	// Open input and type "stripe".
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	if !pm.searchInput {
		t.Fatal("expected `/` to open search input")
	}
	for _, r := range "stripe" {
		pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	if pm.searchQuery != "stripe" {
		t.Fatalf("expected query to live-update to 'stripe', got %q", pm.searchQuery)
	}
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Stripe" {
		t.Fatalf("expected live filter to leave only Stripe, got %+v", pm.filtered)
	}

	// Enter commits — input closes, query stays.
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if pm.searchInput {
		t.Fatal("expected Enter to close input")
	}
	if pm.searchQuery != "stripe" {
		t.Fatalf("expected Enter to keep committed query, got %q", pm.searchQuery)
	}

	// Esc on a committed query clears the search and restores the full list.
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if pm.searchQuery != "" {
		t.Fatalf("expected Esc to clear committed query, got %q", pm.searchQuery)
	}
	if len(pm.filtered) != len(apps) {
		t.Fatalf("expected Esc to restore full list, got %d/%d", len(pm.filtered), len(apps))
	}
}

func TestSearchEscInInputCancelsAndClears(t *testing.T) {
	// Use multiple rows so the test catches a regression where Esc clears the query
	// but forgets to re-apply the filter — the visible count would stay at 1
	// otherwise even though the underlying state went stale.
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
		{Company: "Globex", Role: "Platform Engineer", Status: "Evaluated", Score: 4.0},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.searchInput = true
	pm.searchQuery = "stri"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 {
		t.Fatalf("setup expected 1 row matching 'stri', got %d", len(pm.filtered))
	}

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if pm.searchInput {
		t.Fatal("expected Esc in input mode to close input")
	}
	if pm.searchQuery != "" {
		t.Fatalf("expected Esc in input mode to clear in-progress query, got %q", pm.searchQuery)
	}
	if len(pm.filtered) != len(apps) {
		t.Fatalf("expected Esc to re-expand filtered list to %d rows, got %d", len(apps), len(pm.filtered))
	}
}

func TestSearchResetsCursorOnQueryChange(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Acme", Role: "Backend Engineer", Status: "Evaluated", Score: 4.0},
		{Company: "Beta", Role: "Frontend Engineer", Status: "Evaluated", Score: 4.1},
		{Company: "Gamma", Role: "AI Engineer", Status: "Evaluated", Score: 4.2},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.cursor = 2

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})

	if pm.cursor != 0 {
		t.Fatalf("expected cursor to reset to 0 on query change, got %d", pm.cursor)
	}
	if pm.scrollOffset != 0 {
		t.Fatalf("expected scrollOffset to reset to 0 on query change, got %d", pm.scrollOffset)
	}
}

func TestSearchStatePreservedAcrossReload(t *testing.T) {
	initial := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend", Status: "Evaluated", Score: 4.6},
		{Company: "Acme", Role: "AI", Status: "Evaluated", Score: 4.0},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), initial, model.PipelineMetrics{Total: len(initial)}, "..", 120, 40)
	pm.searchQuery = "stripe"
	pm.applyFilterAndSort()

	refreshed := append([]model.CareerApplication{}, initial...)
	refreshed = append(refreshed, model.CareerApplication{Company: "Globex", Role: "Platform", Status: "Applied", Score: 4.3})

	reloaded := pm.WithReloadedData(refreshed, model.PipelineMetrics{Total: len(refreshed)})

	if reloaded.searchQuery != "stripe" {
		t.Fatalf("expected refresh to preserve search query, got %q", reloaded.searchQuery)
	}
	if len(reloaded.filtered) != 1 || reloaded.filtered[0].Company != "Stripe" {
		t.Fatalf("expected refresh+search to keep filter applied, got %+v", reloaded.filtered)
	}
}

func TestRejectedAndDiscardedTabsFilterCorrectly(t *testing.T) {
	apps := []model.CareerApplication{
		{
			Company:    "Acme",
			Role:       "Backend Engineer",
			Status:     "Rejected",
			Score:      3.4,
			ReportPath: "reports/001-acme.md",
		},
		{
			Company:    "Beta",
			Role:       "Platform Engineer",
			Status:     "Discarded",
			Score:      2.1,
			ReportPath: "reports/002-beta.md",
		},
		{
			Company:    "Gamma",
			Role:       "AI Engineer",
			Status:     "Applied",
			Score:      4.6,
			ReportPath: "reports/003-gamma.md",
		},
	}

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		apps,
		model.PipelineMetrics{Total: len(apps)},
		"..",
		120,
		40,
	)

	pm.activeTab = tabIndexForFilter(t, filterRejected)
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Status != "Rejected" {
		t.Fatalf("expected rejected tab to isolate rejected rows, got %+v", pm.filtered)
	}

	pm.activeTab = tabIndexForFilter(t, filterDiscarded)
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Status != "Discarded" {
		t.Fatalf("expected discarded tab to isolate discarded rows, got %+v", pm.filtered)
	}
}

// Regression: with no committed search query, Esc must NOT close the screen.
// The help bar advertises only `q quit`, so Esc quitting silently was a bug
// that surfaced as accidental exits when users hit Esc to "back out" of the UI.
func TestEscWithoutQueryIsNoOp(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	if pm.searchQuery != "" {
		t.Fatalf("setup expected empty search query, got %q", pm.searchQuery)
	}

	pm, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if cmd != nil {
		// PipelineClosedMsg used to fire here; ensure it doesn't anymore.
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineClosedMsg); ok {
				t.Fatalf("expected Esc with no query to be a no-op, got PipelineClosedMsg")
			}
			t.Fatalf("expected Esc with no query to return nil cmd, got %T", msg)
		}
	}
	if pm.searchInput {
		t.Fatal("Esc with no query should not toggle searchInput")
	}
}

// Regression: typing during search input must not synchronously fan out to
// loadCurrentReport. Reading reports per keystroke caused visible UI lag, so
// the load is deferred to commit (Enter) / cancel (Esc) instead.
func TestSearchTypingDoesNotLoadReports(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6, ReportPath: "reports/001-stripe.md"},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8, ReportPath: "reports/002-anthropic.md"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	if !pm.searchInput {
		t.Fatal("expected `/` to open search input")
	}

	// Typing must not trigger PipelineLoadReportMsg.
	for _, r := range "stri" {
		var cmd tea.Cmd
		pm, cmd = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		if cmd != nil {
			if msg := cmd(); msg != nil {
				if _, ok := msg.(PipelineLoadReportMsg); ok {
					t.Fatalf("typing rune %q should not emit PipelineLoadReportMsg", string(r))
				}
			}
		}
	}

	// Backspace must not trigger PipelineLoadReportMsg either.
	pm, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyBackspace})
	if cmd != nil {
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineLoadReportMsg); ok {
				t.Fatal("Backspace during search input should not emit PipelineLoadReportMsg")
			}
		}
	}

	// Ctrl+U must not trigger PipelineLoadReportMsg either.
	pm, cmd = pm.Update(tea.KeyMsg{Type: tea.KeyCtrlU})
	if cmd != nil {
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineLoadReportMsg); ok {
				t.Fatal("Ctrl+U during search input should not emit PipelineLoadReportMsg")
			}
		}
	}
}
