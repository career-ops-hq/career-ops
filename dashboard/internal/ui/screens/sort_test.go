package screens

import (
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestSortCycleIncludesNewColumns(t *testing.T) {
	want := map[string]bool{sortLocation: false, sortPay: false, sortLast: false}
	for _, s := range sortCycle {
		if _, ok := want[s]; ok {
			want[s] = true
		}
	}
	for mode, found := range want {
		if !found {
			t.Errorf("sort cycle is missing %q", mode)
		}
	}
}

func TestSortByPayLocationAndLastContact(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "LowPay", Status: "Applied", PayMax: 150_000, WorkMode: "Full", Location: "Austin, TX", LastContact: "2026-06-01"},
		{Company: "NoPay", Status: "Applied", PayMax: 0, WorkMode: "", LastContact: ""},
		{Company: "HighPay", Status: "Applied", PayMax: 250_000, WorkMode: "Hybrid", Location: "Charlotte, NC", LastContact: "2026-06-05"},
		{Company: "MidPay", Status: "Applied", PayMax: 200_000, WorkMode: "Remote", LastContact: "2026-06-03"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.viewMode = "flat"

	pm.sortMode = sortPay
	pm.applyFilterAndSort()
	if pm.filtered[0].Company != "HighPay" || pm.filtered[len(pm.filtered)-1].Company != "NoPay" {
		t.Fatalf("pay sort: expected HighPay first and NoPay last, got %s..%s",
			pm.filtered[0].Company, pm.filtered[len(pm.filtered)-1].Company)
	}

	pm.sortMode = sortLocation
	pm.applyFilterAndSort()
	// Remote-first ordering: Remote, Hybrid, Full, unknown.
	wantOrder := []string{"MidPay", "HighPay", "LowPay", "NoPay"}
	for i, w := range wantOrder {
		if pm.filtered[i].Company != w {
			t.Fatalf("location sort: position %d = %s, want %s", i, pm.filtered[i].Company, w)
		}
	}

	pm.sortMode = sortLast
	pm.applyFilterAndSort()
	if pm.filtered[0].Company != "HighPay" || pm.filtered[len(pm.filtered)-1].Company != "NoPay" {
		t.Fatalf("last-contact sort: expected HighPay first and NoPay last, got %s..%s",
			pm.filtered[0].Company, pm.filtered[len(pm.filtered)-1].Company)
	}
}
