package screens

import (
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// A rate with nothing to divide by is absent, not 0%.
//
// career.go computes the three rates only `if applied > 0`, so with nothing
// applied they keep their zero value — and the renderer printed that zero and
// sent it through rateColor, whose default band is Red. A user who had
// evaluated offers but not yet applied to any was told, in red, that their
// response, interview and offer rates were all 0.0%: the dashboard reporting
// the search as failing before it had begun.
//
// Mirrors rateOrNull() in web/src/lib/analytics/view-model.mjs, which gates each
// rate on the count it was taken over rather than on its own value.

func progressWith(m model.ProgressMetrics) ProgressModel {
	return ProgressModel{metrics: m, theme: theme.NewTheme("catppuccin-mocha")}
}

func TestRatesAreAbsentWithNothingApplied(t *testing.T) {
	out := progressWith(model.ProgressMetrics{RatesDenominator: 0}).renderRates()

	if strings.Contains(out, "0.0%") {
		t.Errorf("a rate with no denominator must not print as 0.0%%:\n%s", out)
	}
	if !strings.Contains(out, "—") {
		t.Errorf("expected an em dash standing in for the absent rates:\n%s", out)
	}
}

func TestRatesPrintWhenSomethingWasApplied(t *testing.T) {
	// The other half: a real denominator means real rates, including a real
	// zero. "0 of 12 replied" IS a measurement and must still be shown.
	out := progressWith(model.ProgressMetrics{
		RatesDenominator: 12,
		ResponseRate:     25,
		InterviewRate:    8.3,
		OfferRate:        0,
	}).renderRates()

	for _, want := range []string{"25.0%", "8.3%", "0.0%"} {
		if !strings.Contains(out, want) {
			t.Errorf("expected %s in the rendered rates:\n%s", want, out)
		}
	}
	if strings.Contains(out, "—") {
		t.Errorf("no rate is absent here, so nothing should be dashed:\n%s", out)
	}
}

func TestMeasuredZeroIsNotHiddenByTheGate(t *testing.T) {
	// The failure mode of an over-eager fix: gating on the rate's own value
	// instead of its denominator would hide a genuine 0% — which is a finding
	// the user needs, not an absence. The gate must key off the denominator
	// only.
	out := progressWith(model.ProgressMetrics{
		RatesDenominator: 40,
		ResponseRate:     0,
		InterviewRate:    0,
		OfferRate:        0,
	}).renderRates()

	if strings.Count(out, "0.0%") != 3 {
		t.Errorf("forty applications and no replies is a real 0%% on all three:\n%s", out)
	}
}

func TestStagePercentagesFollowTheSameDenominator(t *testing.T) {
	// safePct returns 0 when the whole is 0, so " (0%)" beside every stage was
	// a share that had never been computed. With no denominator the count alone
	// is the honest answer.
	stages := []model.FunnelStage{
		{Label: "Applied", Count: 0, Pct: 0},
		{Label: "Responded", Count: 0, Pct: 0},
	}

	absent := progressWith(model.ProgressMetrics{RatesDenominator: 0, FunnelStages: stages}).renderFunnel()
	if strings.Contains(absent, "(0%)") {
		t.Errorf("stage share must be omitted with no denominator:\n%s", absent)
	}

	present := progressWith(model.ProgressMetrics{
		RatesDenominator: 10,
		FunnelStages: []model.FunnelStage{
			{Label: "Applied", Count: 10, Pct: 100},
			{Label: "Responded", Count: 3, Pct: 30},
		},
	}).renderFunnel()
	if !strings.Contains(present, "(30%)") {
		t.Errorf("a real share must still print:\n%s", present)
	}
}
