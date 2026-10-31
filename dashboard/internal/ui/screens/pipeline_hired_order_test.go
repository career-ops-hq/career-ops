package screens

import (
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// The grouped view sorts by data.StatusPriority, while the group headers and
// the metrics strip follow statusGroupOrder. The two must agree: Hired is
// first in statusGroupOrder, but StatusPriority had no case for it, so a
// hired row fell to the default bucket and sorted below Rejected and
// Discarded.
func TestStatusPriorityFollowsStatusGroupOrder(t *testing.T) {
	for i := 1; i < len(statusGroupOrder); i++ {
		prev, cur := statusGroupOrder[i-1], statusGroupOrder[i]
		if data.StatusPriority(prev) >= data.StatusPriority(cur) {
			t.Errorf("StatusPriority(%q)=%d is not below StatusPriority(%q)=%d, but statusGroupOrder puts %q first",
				prev, data.StatusPriority(prev), cur, data.StatusPriority(cur), prev)
		}
	}
}

func TestGroupedViewListsHiredFirst(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Acme", Role: "Ops Lead", Status: "Discarded"},
		{Company: "Globex", Role: "Ops Lead", Status: "Hired"},
		{Company: "Initech", Role: "Ops Lead", Status: "Interview"},
		{Company: "Umbrella", Role: "Ops Lead", Status: "Rejected"},
	}
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, t.TempDir(), 120, 40)
	if pm.viewMode != "grouped" {
		t.Fatalf("setup expected the default grouped view, got %q", pm.viewMode)
	}

	got := make([]string, len(pm.filtered))
	for i, app := range pm.filtered {
		got[i] = app.Status
	}
	want := []string{"Hired", "Interview", "Rejected", "Discarded"}
	if len(got) != len(want) {
		t.Fatalf("grouped order = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("grouped order = %v, want %v", got, want)
		}
	}
}
