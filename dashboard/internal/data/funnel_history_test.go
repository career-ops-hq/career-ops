package data

import (
	"fmt"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"os"
	"path/filepath"
	"testing"
)

func TestFunnelHistoryTerminalAchievements(t *testing.T) {
	apps := []model.CareerApplication{}
	for i := 1; i <= 29; i++ {
		status := "Rejected"
		if i <= 10 {
			status = "Applied"
		} else if i <= 15 {
			status = "Responded"
		} else if i <= 17 {
			status = "Interview"
		}
		apps = append(apps, model.CareerApplication{Number: i, Status: status})
	}
	log := ""
	for _, n := range []int{18, 19, 20, 18, 99} {
		log += fmt.Sprintf("%d\t2026-09-01\tInterview\tRejected\n", n)
	}
	log += "21junk\t2026-09-01\tOffer\tHired\n21\t\tOffer\tHired\n"
	pm := ComputeProgressMetrics(apps, parseFunnelHistory(log))
	for i, want := range []int{29, 29, 19, 5, 0} {
		if pm.FunnelStages[i].Count != want {
			t.Errorf("stage %d = %d, want %d", i, pm.FunnelStages[i].Count, want)
		}
	}
}

func TestFunnelHistoryTrackerOverride(t *testing.T) {
	root := t.TempDir()
	t.Setenv("CAREER_OPS_TRACKER", filepath.Join(root, "custom.md"))
	if err := os.WriteFile(filepath.Join(root, "status-log.tsv"), []byte("1\t2026-09-01\tOffer\tDiscarded\n"), 0600); err != nil {
		t.Fatal(err)
	}
	pm := ComputeProgressMetrics([]model.CareerApplication{{Number: 1, Status: "Discarded"}}, ReadFunnelHistory(root))
	if pm.FunnelStages[4].Count != 1 || pm.TotalOffers != 1 {
		t.Fatal("discarded offer lost from overridden tracker ledger")
	}
}

func TestBackfilledDisplayNumberDoesNotJoinHistory(t *testing.T) {
	apps := []model.CareerApplication{
		{Number: 1, Status: "Applied", TrackerNumberMissing: true},
		{Number: 1, Status: "Rejected"},
	}
	pm := ComputeProgressMetrics(apps, map[int]int{1: 3})
	if pm.FunnelStages[1].Count != 2 || pm.FunnelStages[3].Count != 1 {
		t.Fatal("synthetic display number joined another row's history")
	}
}
