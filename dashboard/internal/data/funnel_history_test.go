package data

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
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
	for i, want := range []int{29, 29, 19, 5, 5, 0} {
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
	history, err := ReadFunnelHistory(root)
	if err != nil {
		t.Fatal(err)
	}
	pm := ComputeProgressMetrics([]model.CareerApplication{{Number: 1, Status: "Discarded"}}, history)
	if stageCount(pm, "Offer") != 1 || pm.TotalOffers != 1 {
		t.Fatal("discarded offer lost from overridden tracker ledger")
	}
}

func TestReadFunnelHistoryMissingLedger(t *testing.T) {
	root := t.TempDir()
	t.Setenv("CAREER_OPS_TRACKER", filepath.Join(root, "applications.md"))
	history, err := ReadFunnelHistory(root)
	if err != nil || len(history) != 0 {
		t.Fatalf("missing ledger = %v, %v; want empty history without an error", history, err)
	}
	pm := ComputeProgressMetrics([]model.CareerApplication{{Number: 1, Status: "Offer"}}, history)
	if pm.TotalOffers != 1 {
		t.Fatal("missing ledger should still count current achievements")
	}
}

func TestReadFunnelHistoryPropagatesReadFailure(t *testing.T) {
	root := t.TempDir()
	t.Setenv("CAREER_OPS_TRACKER", filepath.Join(root, "applications.md"))
	ledger := filepath.Join(root, "status-log.tsv")
	// A directory reliably fails ReadFile, including when tests run as root.
	if err := os.Mkdir(ledger, 0700); err != nil {
		t.Fatal(err)
	}
	history, err := ReadFunnelHistory(root)
	var pathErr *os.PathError
	if !errors.As(err, &pathErr) || pathErr.Path != ledger {
		t.Fatalf("read failure = %v, want the ledger's underlying PathError", err)
	}
	if history != nil {
		t.Fatalf("failed read returned history: %v", history)
	}
}

func TestBackfilledDisplayNumberDoesNotJoinHistory(t *testing.T) {
	apps := []model.CareerApplication{
		{Number: 1, Status: "Applied", TrackerNumberMissing: true},
		{Number: 1, Status: "Rejected"},
	}
	pm := ComputeProgressMetrics(apps, map[int]int{1: funnelRank("Interview")})
	if stageCount(pm, "Applied") != 2 || stageCount(pm, "Interview") != 1 {
		t.Fatal("synthetic display number joined another row's history")
	}
}

func TestFunnelHistoryDuplicateRanksAndSkip(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		apps := []model.CareerApplication{
			{Number: 7, Status: "Applied"},
			{Number: 7, Status: "Offer"},
			{Number: 8, Status: "SKIP"},
			{Number: 9, Status: "skip"},
			{Number: 10, Status: "Discarded"},
			{Number: 11, Status: "**SKIP**"},
			{Number: 12, Status: "No Aplicar"},
		}
		if reverse {
			for i, j := 0, len(apps)-1; i < j; i, j = i+1, j-1 {
				apps[i], apps[j] = apps[j], apps[i]
			}
		}
		pm := ComputeProgressMetrics(apps, map[int]int{7: 2, 8: 5, 9: 4, 10: 4, 11: 5, 12: 5})
		for i, want := range []int{7, 2, 2, 2, 2, 1} {
			if pm.FunnelStages[i].Count != want {
				t.Errorf("reverse=%v stage %d: got %d want %d", reverse, i, pm.FunnelStages[i].Count, want)
			}
		}
		if pm.TotalOffers != 1 {
			t.Errorf("offers = %d", pm.TotalOffers)
		}
	}
}
