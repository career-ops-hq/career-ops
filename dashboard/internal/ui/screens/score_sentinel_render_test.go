package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// A row whose Score cell is a sentinel has no number to print: the renderer
// must show the tracker's own sentinel, not "0.0", and the cell must still
// occupy the same width as a numeric score so the row measures correctly.
func TestRenderAppLineScoreSentinel(t *testing.T) {
	scoredApp := model.CareerApplication{Company: "Scored", Role: "QA Engineer", Status: "Evaluated", Score: 4.2, ScoreRaw: "4.2/5", HasScore: true}
	m := NewPipelineModel(theme.NewTheme(""), []model.CareerApplication{scoredApp}, model.PipelineMetrics{}, t.TempDir(), 120, 40)

	scored := m.renderAppLine(scoredApp, false)
	if !strings.Contains(scored, "4.2") {
		t.Errorf("scored row = %q, want it to contain 4.2", scored)
	}

	cases := []struct{ raw, want string }{
		{"\u2014", "\u2014"},
		{"N/A", "N/A"},
		{"-", "-"},
		{"", "\u2014"},
	}
	for _, c := range cases {
		app := model.CareerApplication{Company: "Unscored", Role: "SDET", Status: "Evaluated", ScoreRaw: c.raw}
		unscored := m.renderAppLine(app, false)
		if strings.Contains(unscored, "0.0") {
			t.Errorf("ScoreRaw %q: row = %q, want no 0.0", c.raw, unscored)
		}
		if !strings.Contains(unscored, c.want) {
			t.Errorf("ScoreRaw %q: row = %q, want sentinel %q", c.raw, unscored, c.want)
		}
		if got, want := lipgloss.Width(unscored), lipgloss.Width(scored); got != want {
			t.Errorf("ScoreRaw %q: row width = %d, scored row width = %d; want equal", c.raw, got, want)
		}
	}
}
