package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// With no scored row there is no average. Both headers printed AvgScore as-is,
// so an unscored tracker read "Avg 0.0/5" and "0.0 avg score", a mean taken
// over no values that looks like a pipeline scored at zero.
func TestHeadersShowNoAverageOverNoScores(t *testing.T) {
	th := theme.NewTheme("")

	unscored := ansi.Strip(NewPipelineModel(th, nil, model.PipelineMetrics{Total: 3}, t.TempDir(), 120, 30).renderHeader())
	if strings.Contains(unscored, "0.0") || !strings.Contains(unscored, "Avg —/5") {
		t.Errorf("pipeline header with no scores = %q, want \"Avg —/5\"", unscored)
	}
	scored := ansi.Strip(NewPipelineModel(th, nil, model.PipelineMetrics{Total: 3, AvgScore: 4.3}, t.TempDir(), 120, 30).renderHeader())
	if !strings.Contains(scored, "Avg 4.3/5") {
		t.Errorf("pipeline header with scores = %q, want \"Avg 4.3/5\"", scored)
	}

	progUnscored := ansi.Strip(NewProgressModel(th, model.ProgressMetrics{}, 120, 30).renderHeader())
	if strings.Contains(progUnscored, "0.0") || !strings.Contains(progUnscored, "— avg score") {
		t.Errorf("progress header with no scores = %q, want \"— avg score\"", progUnscored)
	}
	progScored := ansi.Strip(NewProgressModel(th, model.ProgressMetrics{AvgScore: 4.3}, 120, 30).renderHeader())
	if !strings.Contains(progScored, "4.3 avg score") {
		t.Errorf("progress header with scores = %q, want \"4.3 avg score\"", progScored)
	}
}
