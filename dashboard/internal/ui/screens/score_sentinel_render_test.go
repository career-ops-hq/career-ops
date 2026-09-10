package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// A row whose Score cell is a sentinel has no number to print: the renderer
// must show the em dash, not "0.0", and the cell must still occupy the same
// width as a numeric score so the row measures correctly.
func TestRenderAppLineScoreSentinel(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Scored", Role: "QA Engineer", Status: "Evaluated", Score: 4.2, ScoreRaw: "4.2/5", HasScore: true},
		{Company: "Unscored", Role: "SDET", Status: "Evaluated", ScoreRaw: "—"},
	}
	m := NewPipelineModel(theme.NewTheme(""), apps, model.PipelineMetrics{}, t.TempDir(), 120, 40)

	scored := m.renderAppLine(apps[0], false)
	if !strings.Contains(scored, "4.2") {
		t.Errorf("scored row = %q, want it to contain 4.2", scored)
	}

	unscored := m.renderAppLine(apps[1], false)
	if strings.Contains(unscored, "0.0") {
		t.Errorf("unscored row = %q, want no 0.0", unscored)
	}
	if !strings.Contains(unscored, "—") {
		t.Errorf("unscored row = %q, want the em-dash sentinel", unscored)
	}
	if got, want := lipgloss.Width(unscored), lipgloss.Width(scored); got != want {
		t.Errorf("unscored row width = %d, scored row width = %d; want equal", got, want)
	}
}
