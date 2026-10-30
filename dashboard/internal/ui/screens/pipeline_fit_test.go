package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// fitWidthApps is a small fictional pipeline with the columns that make an
// 80-column row overflow: date, location, and pay are on by default.
func fitWidthApps() []model.CareerApplication {
	return []model.CareerApplication{
		{
			Number: 1, Company: "Fernhollow Labs", Role: "Platform Engineer",
			Status: "Evaluated", Score: 4.2, HasScore: true,
			Date: "2026-08-01", Location: "Remote", WorkMode: "Remote",
			PayRange: "$140k-$175k", PaySource: "POSTED",
		},
		{
			Number: 2, Company: "Cinderwell Systems", Role: "Backend Engineer",
			Status: "Interview", Score: 3.8, HasScore: true,
			Date: "2026-08-03", Location: "Remote", WorkMode: "Hybrid",
			PayRange: "$160k-$190k",
		},
		{
			Number: 3, Company: "Northglass Analytics", Role: "Data Engineer",
			Status: "Discarded", Score: 2.1, HasScore: true,
			Date: "2026-08-04", Notes: "salary_too_low",
		},
	}
}

func fitWidthMetrics(apps []model.CareerApplication) model.PipelineMetrics {
	return model.PipelineMetrics{
		Total:    len(apps),
		AvgScore: 3.4,
		ByStatus: map[string]int{
			"evaluated": 1,
			"interview": 1,
			"discarded": 1,
		},
	}
}

func viewLines(s string) []string {
	s = strings.TrimRight(s, "\n")
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}

func assertViewFits(t *testing.T, view string, width, height int) {
	t.Helper()
	lines := viewLines(view)
	if len(lines) > height {
		t.Errorf("view is %d lines, terminal is %d high", len(lines), height)
	}
	for i, line := range lines {
		if w := lipgloss.Width(line); w > width {
			t.Errorf("line %d is %d cells wide, terminal is %d", i, w, width)
		}
	}
}

func TestPipelineFitsNarrowTerminal(t *testing.T) {
	i18n.SetLang("en")
	t.Cleanup(func() { i18n.SetLang("en") })

	apps := fitWidthApps()
	metrics := fitWidthMetrics(apps)

	for _, size := range []struct{ w, h int }{{80, 24}, {60, 24}} {
		t.Run(string(rune('0'+size.w/10)), func(t *testing.T) {
			m := NewPipelineModel(theme.NewTheme(""), apps, metrics, t.TempDir(), size.w, size.h)
			view := m.View()
			assertViewFits(t, view, size.w, size.h)
			if !strings.Contains(view, i18n.Current.AppTitle) {
				t.Errorf("title %q is not in the view", i18n.Current.AppTitle)
			}
			sawRow := false
			for _, line := range viewLines(view) {
				if strings.Contains(line, "#1") {
					sawRow = true
					if !strings.Contains(line, "Eval") {
						t.Errorf("status wrapped off the #1 row: %q", line)
					}
				}
			}
			if !sawRow {
				t.Error("#1 is not on screen")
			}
			help := m.renderHelp()
			if strings.Contains(help, "\n") {
				t.Error("help bar wrapped, so the height budget counts one row for several")
			}
			if !strings.Contains(help, "?") || !strings.Contains(help, "quit") {
				t.Errorf("narrow help dropped the key list or quit: %q", help)
			}
			if app, ok := m.CurrentApp(); ok && strings.Contains(m.renderAppLine(app, true), "\n") {
				t.Error("selected row wrapped onto a second line")
			}

			m.activeTab = tabIndexForFilter(t, filterDiscarded)
			m.applyFilterAndSort()
			tabbed := m.View()
			assertViewFits(t, tabbed, size.w, size.h)
			if !strings.Contains(tabbed, i18n.Current.TabDiscarded) {
				t.Errorf("active tab %q is not in the view", i18n.Current.TabDiscarded)
			}
		})
	}
}

func TestKeysHelpFitsAndQDoesNotQuit(t *testing.T) {
	i18n.SetLang("en")
	m := NewPipelineModel(theme.NewTheme(""), fitWidthApps(), fitWidthMetrics(fitWidthApps()), t.TempDir(), 80, 24)

	opened, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'?'}})
	view := opened.View()
	assertViewFits(t, view, 80, 24)
	if !strings.Contains(view, "open PDF") || !strings.Contains(view, "top/end") {
		t.Fatalf("key list is missing bindings the footer cannot fit:\n%s", view)
	}
	if !strings.Contains(view, i18n.Current.AppTitle) {
		t.Fatal("key list pushed the title off the view")
	}

	closed, cmd := opened.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	if cmd != nil {
		if _, ok := cmd().(PipelineClosedMsg); ok {
			t.Fatal("`q` quit the dashboard instead of closing the key list")
		}
	}
	if strings.Contains(closed.View(), "top/end") {
		t.Fatal("`q` left the key list open")
	}

	searching := m
	searching.searchInput = true
	typed, _ := searching.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'?'}})
	if !strings.Contains(typed.searchQuery, "?") {
		t.Fatal("`?` did not type into the search query")
	}
	if strings.Contains(typed.View(), "top/end") {
		t.Fatal("`?` opened the key list while search input was active")
	}
}

func TestStatusPickerStaysInsideTheTerminal(t *testing.T) {
	i18n.SetLang("en")
	m := NewPipelineModel(theme.NewTheme(""), fitWidthApps(), fitWidthMetrics(fitWidthApps()), t.TempDir(), 80, 24)
	opened, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}})
	if !opened.statusPicker {
		t.Fatal("`c` did not open the status picker")
	}
	view := opened.View()
	assertViewFits(t, view, 80, 24)
	if !strings.Contains(view, i18n.Current.AppTitle) {
		t.Fatal("status picker pushed the title out of the view")
	}
}

func TestOpenFailureFlashKeepsTheReason(t *testing.T) {
	m := NewPipelineModel(theme.NewTheme(""), fitWidthApps(), fitWidthMetrics(fitWidthApps()), t.TempDir(), 80, 24)
	m.flash = "Could not open https://boards.example.com/cinderwell-systems/jobs/400003: exit status 1"
	out := m.renderHelp()
	if strings.Contains(out, "\n") {
		t.Fatalf("flash wrapped onto a second line: %q", out)
	}
	if lipgloss.Width(out) > 80 {
		t.Fatalf("flash is %d cells wide", lipgloss.Width(out))
	}
	if !strings.Contains(out, "exit status 1") {
		t.Fatalf("flash dropped the failure reason: %q", out)
	}
}

func TestViewerFooterStaysOneLineWhenNarrow(t *testing.T) {
	i18n.SetLang("en")
	m := ViewerModel{
		width:  60,
		height: 24,
		theme:  theme.NewTheme(""),
		title:  "Fernhollow Labs — Platform Engineer",
		jobURL: "https://boards.example.com/fernhollow-labs/jobs/1",
	}
	footer := m.renderFooter()
	if strings.Contains(footer, "\n") {
		t.Fatalf("viewer footer wrapped:\n%s", footer)
	}
	if w := lipgloss.Width(footer); w > 60 {
		t.Fatalf("viewer footer is %d cells wide", w)
	}
}

func TestProgressAndStatsChromeStayOneLineWhenNarrow(t *testing.T) {
	i18n.SetLang("en")
	progress := NewProgressModel(theme.NewTheme(""), model.ProgressMetrics{
		FunnelStages: []model.FunnelStage{{Label: "Evaluated", Count: 3, Pct: 100}},
		AvgScore:     3.4,
	}, 60, 24)
	for name, block := range map[string]string{
		"progress header": progress.renderHeader(),
		"progress help":   progress.renderHelp(),
	} {
		if strings.Contains(block, "\n") || lipgloss.Width(block) > 60 {
			t.Errorf("%s is %d wide and wrapped=%v", name, lipgloss.Width(block), strings.Contains(block, "\n"))
		}
	}

	stats := NewStatsModel(theme.NewTheme(""), model.StatsMetrics{}, 3, 60, 24)
	for name, block := range map[string]string{
		"stats header": stats.renderHeader(),
		"stats help":   stats.renderHelp(),
	} {
		if strings.Contains(block, "\n") || lipgloss.Width(block) > 60 {
			t.Errorf("%s is %d wide and wrapped=%v", name, lipgloss.Width(block), strings.Contains(block, "\n"))
		}
	}
}

func TestKeysHelpFooterOffersCloseNotQuit(t *testing.T) {
	i18n.SetLang("en")
	m := NewPipelineModel(theme.NewTheme(""), fitWidthApps(), fitWidthMetrics(fitWidthApps()), t.TempDir(), 80, 24)
	m.keysHelp = true
	out := m.renderHelp()
	if strings.Contains(out, "quit") {
		t.Fatalf("footer offers quit while the key list is open: %q", out)
	}
	if !strings.Contains(out, "close") {
		t.Fatalf("footer does not say how to close the key list: %q", out)
	}
}

func TestFitPlainCountsWideRunesAsCells(t *testing.T) {
	// 20 CJK runes are 40 cells. The rune count fits a 30-cell budget, the
	// cells do not.
	wide := strings.Repeat("報", 20)
	if got := fitPlain(30, wide); lipgloss.Width(got) > 30 {
		t.Fatalf("fitPlain(30) is %d cells: %q", lipgloss.Width(got), got)
	}
	long := "Could not open " + strings.Repeat("履歴書", 15) + "-fernhollow.pdf: exit status 1"
	got := fitPlain(60, long)
	if lipgloss.Width(got) > 60 {
		t.Fatalf("fitPlain(60) is %d cells: %q", lipgloss.Width(got), got)
	}
	if !strings.HasSuffix(got, "exit status 1") {
		t.Fatalf("fitPlain dropped the failure reason: %q", got)
	}
}

func TestDiscardPickerKeepsTheTypedTailOnScreen(t *testing.T) {
	i18n.SetLang("en")
	m := NewPipelineModel(theme.NewTheme(""), fitWidthApps(), fitWidthMetrics(fitWidthApps()), t.TempDir(), 60, 24)
	m.discardPicker = true
	m.discardCustomInput = true
	m.discardCustomText = strings.Repeat("the team moved the role to a later quarter ", 3) + "END"
	view := m.overlayDiscardPicker("")
	if !strings.Contains(view, "END") || !strings.Contains(view, "█") {
		t.Fatalf("typed tail or cursor is off screen:\n%s", view)
	}
	for i, line := range viewLines(view) {
		if w := lipgloss.Width(line); w > 60 {
			t.Errorf("line %d is %d cells wide", i, w)
		}
	}

	m.discardCustomInput = false
	m.discardOptions = []string{"Pay is below my floor and the posting says the band is fixed for the year END"}
	m.discardCursor = 0
	view = m.overlayDiscardPicker("")
	if !strings.Contains(view, "Pay is below") || !strings.Contains(view, "...") {
		t.Fatalf("long option row was not cut to one line:\n%s", view)
	}
}
