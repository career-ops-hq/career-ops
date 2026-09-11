package data

import (
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// apps builds a slice of applications from a status -> count map-ish list.
func appsWithStatuses(statuses ...string) []model.CareerApplication {
	out := make([]model.CareerApplication, 0, len(statuses))
	for i, s := range statuses {
		out = append(out, model.CareerApplication{Number: i + 1, Status: s})
	}
	return out
}

func stageCount(pm model.ProgressMetrics, label string) int {
	for _, s := range pm.FunnelStages {
		if s.Label == label {
			return s.Count
		}
	}
	return -1
}

// A hire is terminal success and proves every earlier stage. It must count into
// Applied, Responded, Interview and Offer — the same cumulative math stats.mjs's
// computeFunnel() documents as mirroring this function. Before the fix "hired"
// appeared in no tier, so a landed job rendered as an entirely empty funnel.
func TestComputeProgressMetricsCountsHiredInEveryStage(t *testing.T) {
	pm := ComputeProgressMetrics(appsWithStatuses("Hired"))

	for _, tc := range []struct {
		label string
		want  int
	}{
		{"Tracked", 1},
		{"Applied", 1},
		{"Responded", 1},
		{"Interview", 1},
		{"Offer", 1},
	} {
		if got := stageCount(pm, tc.label); got != tc.want {
			t.Errorf("funnel stage %q = %d, want %d (a hire proves every earlier stage)", tc.label, got, tc.want)
		}
	}

	if pm.TotalOffers != 1 {
		t.Errorf("TotalOffers = %d, want 1 (a hire proves an offer was received)", pm.TotalOffers)
	}
}

// With a hire in the denominator and numerator, the rates must be real numbers
// rather than the 0%% the missing tiers produced.
func TestComputeProgressMetricsRatesIncludeHired(t *testing.T) {
	// 1 hired + 1 rejected: everApplied = 2, everResponded/Interview/Offer = 1.
	pm := ComputeProgressMetrics(appsWithStatuses("Hired", "Rejected"))

	if pm.ResponseRate != 50 {
		t.Errorf("ResponseRate = %v, want 50", pm.ResponseRate)
	}
	if pm.InterviewRate != 50 {
		t.Errorf("InterviewRate = %v, want 50", pm.InterviewRate)
	}
	if pm.OfferRate != 50 {
		t.Errorf("OfferRate = %v, want 50", pm.OfferRate)
	}
}

// The cumulative tiers must stay ordered: each stage is a superset of the next.
func TestComputeProgressMetricsFunnelIsMonotonic(t *testing.T) {
	pm := ComputeProgressMetrics(appsWithStatuses(
		"Evaluated", "Applied", "Responded", "Interview", "Offer", "Hired", "Rejected", "Discarded", "SKIP",
	))

	applied := stageCount(pm, "Applied")
	responded := stageCount(pm, "Responded")
	interview := stageCount(pm, "Interview")
	offer := stageCount(pm, "Offer")

	if !(applied >= responded && responded >= interview && interview >= offer) {
		t.Errorf("funnel not monotonic: applied=%d responded=%d interview=%d offer=%d",
			applied, responded, interview, offer)
	}
	// applied = applied+responded+interview+offer+hired+rejected = 6
	if applied != 6 {
		t.Errorf("Applied = %d, want 6", applied)
	}
	// responded = responded+interview+offer+hired = 4
	if responded != 4 {
		t.Errorf("Responded = %d, want 4", responded)
	}
	// interview = interview+offer+hired = 3
	if interview != 3 {
		t.Errorf("Interview = %d, want 3", interview)
	}
	// offer = offer+hired = 2
	if offer != 2 {
		t.Errorf("Offer = %d, want 2", offer)
	}
}

// The top funnel stage counts every tracked row, scored or not — a row
// backfilled without an evaluation (#1799) sits there with no score. So it must
// not borrow the word the Stats header uses for the scored count, nor the
// canonical "Evaluated" status: computeFunnel() in stats.mjs already warns that
// the same word standing for two different numbers reads as a bug, and this
// label made it three.
//
// The AvgScore assertion is the other half of the same defect: the Progress
// header renders this stage's count and AvgScore side by side, but AvgScore
// divides by the scored rows only. Naming the count honestly is what stops the
// two halves of that line from contradicting each other.
func TestFunnelTopStageCountsUnscoredRowsAndIsNotNamedEvaluated(t *testing.T) {
	apps := appsWithStatuses("Applied", "Applied")
	apps[0].Score = 4.2 // one evaluated, one backfilled with no evaluation

	pm := ComputeProgressMetrics(apps)

	if got := stageCount(pm, "Tracked"); got != 2 {
		t.Errorf("Tracked stage = %d, want 2 — both rows are tracked even though only one carries a score", got)
	}
	if pm.AvgScore != 4.2 {
		t.Errorf("AvgScore = %v, want 4.2 — the average covers scored rows only, which is why the count beside it cannot be called 'evaluated'", pm.AvgScore)
	}
}
