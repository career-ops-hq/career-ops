package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// makeStatsModel is a test helper that builds a StatsModel with enough
// ScoreTiers to produce a multi-screen body at the given terminal size.
func makeStatsModel(t *testing.T, width, height int, metrics model.StatsMetrics) StatsModel {
	t.Helper()
	return NewStatsModel(theme.NewTheme("catppuccin-mocha"), metrics, 10, width, height)
}

// metricsWithQualityBar returns a StatsMetrics where QualityBarPct > 0 and
// both ScoreTiers and SeniorityMix are populated — enough to trigger badge
// rendering inside renderPieChart when showQualityBadge==true.
func metricsWithQualityBar() model.StatsMetrics {
	return model.StatsMetrics{
		QualityBarPct: 55.0,
		ScoreTiers: []model.LabelCountStat{
			{Label: "Elite (≥4.5)", Count: 3, Pct: 30},
			{Label: "Strong (4.0-4.4)", Count: 3, Pct: 25},
			{Label: "Below Bar (<3.0)", Count: 4, Pct: 45},
		},
		SeniorityMix: []model.LabelCountStat{
			{Label: "Senior", Count: 5, Pct: 50},
			{Label: "Junior / Entry", Count: 5, Pct: 50},
		},
	}
}

// TestStatsScrollClampUsesFullBody verifies that after scrolling well past the
// visible window, Update() clamps scrollOffset against the real full-body line
// count — not against the truncated View() output.  Before the fix the clamp
// derived maxOffset from View() which was already truncated to availHeight,
// leaving maxOffset ≈ 2 and making content below the fold unreachable.
func TestStatsScrollClampUsesFullBody(t *testing.T) {
	const termWidth, termHeight = 80, 10 // deliberately tiny to force scrolling
	m := makeStatsModel(t, termWidth, termHeight, metricsWithQualityBar())

	// Compute the real full-body line count as Update() should now do.
	fullBodyLines := strings.Count(m.renderBody(), "\n") + 1
	availHeight := termHeight - 4
	if availHeight < 3 {
		availHeight = 3
	}
	wantMaxOffset := fullBodyLines - availHeight
	if wantMaxOffset < 0 {
		wantMaxOffset = 0
	}

	// Skip test if content fits in a single screen — there's nothing to scroll.
	if wantMaxOffset == 0 {
		t.Skip("body fits in terminal; scroll clamping not exercised at this size")
	}

	// Drive a large page-down (well past end).
	msg := tea.KeyMsg{Type: tea.KeyPgDown}
	for range 20 {
		m, _ = m.Update(msg)
	}

	if m.scrollOffset > wantMaxOffset {
		t.Errorf("scrollOffset %d > maxOffset %d: clamping used truncated view height instead of full body height",
			m.scrollOffset, wantMaxOffset)
	}
	if m.scrollOffset < wantMaxOffset {
		// Offset should reach all the way to the max, not stop at some lower value.
		t.Errorf("scrollOffset %d < maxOffset %d: content below the fold is unreachable",
			m.scrollOffset, wantMaxOffset)
	}
}

// TestStatsQualityBadgeOnlyInFitQualityChart verifies that the >=4.0 quality
// bar badge appears inside the Fit Quality Distribution pie chart and does NOT
// appear inside the Seniority Mix pie chart.
func TestStatsQualityBadgeOnlyInFitQualityChart(t *testing.T) {
	metrics := metricsWithQualityBar()

	// Render both charts directly through renderPieChart with their respective
	// showQualityBadge arguments, matching the production call sites.
	m := makeStatsModel(t, 120, 40, metrics)

	fitQuality := m.renderPieChart(
		"Fit Quality Distribution",
		"Quality Breakdown",
		metrics.ScoreTiers,
		[]lipgloss.Color{m.theme.Green, m.theme.Sky, m.theme.Red},
		true, // showQualityBadge=true
	)
	seniority := m.renderPieChart(
		"Seniority Mix",
		"Seniority Mix",
		metrics.SeniorityMix,
		[]lipgloss.Color{m.theme.Mauve, m.theme.Peach},
		false, // showQualityBadge=false
	)

	// The badge text includes the QualityBarPct value. A simple percentage
	// substring is reliable enough without importing the i18n format string.
	badge := "55"

	if !strings.Contains(fitQuality, badge) {
		t.Errorf("expected quality bar badge in Fit Quality chart but it was absent")
	}
	if strings.Contains(seniority, badge) {
		t.Errorf("quality bar badge must not appear in Seniority Mix chart but it was present")
	}
}

// A tier's slice colour follows its label, not its position: ScoreTiers omits
// empty tiers, so with Viable and Below Bar alone the positional palette drew
// Viable in Elite's green and Below Bar in Strong's blue.
func TestScoreTierColorsFollowTheLabel(t *testing.T) {
	th := theme.NewTheme("catppuccin-mocha")
	got := scoreTierColors(th, []model.LabelCountStat{
		{Label: "Viable (3.5-3.9)", Count: 2},
		{Label: "Below Bar (<3.0)", Count: 1},
	})
	if len(got) != 2 || got[0] != th.Yellow || got[1] != th.Red {
		t.Errorf("Viable/Below Bar colours = %v, want [Yellow %v, Red %v]", got, th.Yellow, th.Red)
	}

	all := scoreTierColors(th, []model.LabelCountStat{
		{Label: "Elite (≥4.5)"}, {Label: "Strong (4.0-4.4)"}, {Label: "Viable (3.5-3.9)"},
		{Label: "Moderate (3.0-3.4)"}, {Label: "Below Bar (<3.0)"},
	})
	want := []lipgloss.Color{th.Green, th.Sky, th.Yellow, th.Peach, th.Red}
	for i := range want {
		if all[i] != want[i] {
			t.Errorf("tier %d colour = %v, want %v", i, all[i], want[i])
		}
	}

	if other := scoreTierColors(th, []model.LabelCountStat{{Label: "Unscored"}}); other[0] != th.Mauve {
		t.Errorf("unknown tier colour = %v, want neutral Mauve %v", other[0], th.Mauve)
	}
}
