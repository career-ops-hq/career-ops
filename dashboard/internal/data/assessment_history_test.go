package data

import (
	"github.com/santifer/career-ops/dashboard/internal/model"
	"testing"
)

func TestAssessmentHistoryNeverImpliesInterview(t *testing.T) {
	apps := []model.CareerApplication{{Number: 1, Status: "Assessment"}, {Number: 2, Status: "Discarded"}}
	history := parseFunnelHistory("2\t2026-10-01\tAssessment\tDiscarded\n")
	pm := ComputeProgressMetrics(apps, history)
	for _, label := range []string{"Applied", "Responded", "Assessment"} {
		if got := stageCount(pm, label); got != 2 {
			t.Errorf("%s = %d, want 2", label, got)
		}
	}
	for _, label := range []string{"Interview", "Offer"} {
		if got := stageCount(pm, label); got != 0 {
			t.Errorf("%s = %d, want 0", label, got)
		}
	}
}
