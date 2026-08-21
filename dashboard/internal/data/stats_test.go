package data

import (
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

func TestCanonicalizeArchetype(t *testing.T) {
	tests := []struct {
		raw      string
		expected string
	}{
		{raw: "Technical AI PM (primary) + AI Platform / LLMOps", expected: "Technical AI PM"},
		{raw: "Technical AI PM", expected: "Technical AI PM"},
		{raw: "Senior AI Product Manager", expected: "Technical AI PM"},
		{raw: "AI Platform / LLMOps", expected: "AI Platform & LLMOps"},
		{raw: "Agentic Automation Engineer", expected: "Agentic & Automation"},
		{raw: "Solutions Architect AI", expected: "AI Solutions & FDE"},
		{raw: "ML Engineer / Applied AI", expected: "AI & ML Engineering"},
		{raw: "Digital Transformation Consultant", expected: "AI Transformation & Governance"},
		{raw: "Data Governance Specialist", expected: "AI Transformation & Governance"},
		{raw: "Senior Data Engineer", expected: "Data & Analytics"},
		{raw: "IT Support Specialist", expected: "IT & Technical Operations"},
		{raw: "Wissenschaftliche Mitarbeiterin", expected: "Research & Academia"},
		{raw: "None", expected: "Unclassified"},
		{raw: "Unknown", expected: "Unclassified"},
		{raw: "random other role", expected: "Other / Cross-Functional"},
	}

	for _, tt := range tests {
		got := CanonicalizeArchetype(tt.raw)
		if got != tt.expected {
			t.Errorf("CanonicalizeArchetype(%q) = %q, want %q", tt.raw, got, tt.expected)
		}
	}
}

func TestCanonicalizeLocation(t *testing.T) {
	tests := []struct {
		raw      string
		expected string
	}{
		{raw: "berlin", expected: "Berlin"},
		{raw: "Berlin", expected: "Berlin"},
		{raw: "Munich", expected: "Munich"},
		{raw: "münchen", expected: "Munich"},
		{raw: "Req, ID", expected: ""},
		{raw: "Social Sciences, IN", expected: ""},
		{raw: "Department of CS", expected: ""},
		{raw: "Austin, TX", expected: "Austin, TX"},
		{raw: "austin, tx", expected: "Austin, TX"},
		{raw: "Job, ID", expected: ""},
		{raw: "madrid", expected: "Madrid"},
		{raw: "lisbon", expected: "Lisbon"},
		{raw: "", expected: ""},
		{raw: "—", expected: ""},
		// 3-part: first part alias-resolved, remaining parts normalized with stable casing rule
		{raw: "berlin, de, remote", expected: "Berlin, DE, Remote"},
		{raw: "BERLIN, DE, REMOTE", expected: "Berlin, DE, Remote"},
		{raw: "Berlin, de, Remote", expected: "Berlin, DE, Remote"},
		// 3-part where first part does not resolve -> empty
		{raw: "Req, ID, extra", expected: ""},
		// Non-ASCII UTF-8 titleCase inputs
		{raw: "ΑΘΉΝΑ", expected: "Αθήνα"},
		{raw: "élan", expected: "Élan"},
		// Trailing-comma regression: "City," should canonicalize to just the city
		{raw: "Berlin,", expected: "Berlin"},
		{raw: "berlin,", expected: "Berlin"},
		{raw: "munich,", expected: "Munich"},
		// Trailing-comma with whitespace: "Berlin, " -> state trims to "" -> return city
		{raw: "Berlin, ", expected: "Berlin"},
	}

	for _, tt := range tests {
		got := CanonicalizeLocation(tt.raw)
		if got != tt.expected {
			t.Errorf("CanonicalizeLocation(%q) = %q, want %q", tt.raw, got, tt.expected)
		}
	}
}

func TestComputeStatsMetrics(t *testing.T) {
	// Exercise score tiers, work modes, locations, pay bands, and seniority mix
	apps := []model.CareerApplication{
		{
			Archetype: "Technical AI PM",
			Score:     4.5,
			WorkMode:  "Remote",
			Location:  "Berlin",
			PayMax:    180000,
			PaySource: "POSTED",
			Role:      "Senior Product Manager",
		}, // app 1
		{
			Archetype: "Senior AI Product Manager",
			Score:     4.0,
			WorkMode:  "Remote",
			Location:  "Berlin",
			PayMax:    200000,
			PaySource: "POSTED",
			Role:      "Staff ML Engineer",
		}, // app 2
		{
			Archetype: "Solutions Architect AI",
			Score:     3.2,
			WorkMode:  "Hybrid",
			Location:  "Munich",
			PayMax:    120000,
			PaySource: "est",
			Role:      "Junior Machine Learning Engineer",
		}, // app 3
		{
			Archetype: "Research Scientist",
			Score:     2.1,
			WorkMode:  "Onsite",
			Location:  "Munich",
			PayMax:    90000,
			PaySource: "POSTED",
			Role:      "Intern AI Researcher",
		}, // app 4
	}

	metrics := ComputeStatsMetrics(apps)

	// Test Archetypes (Technical AI PM, AI Solutions & FDE, Research & Academia)
	if len(metrics.Archetypes) != 3 {
		t.Fatalf("expected 3 canonical archetypes, got %d", len(metrics.Archetypes))
	}
	if metrics.Archetypes[0].Label != "Technical AI PM" || metrics.Archetypes[0].Count != 2 {
		t.Errorf("expected Technical AI PM count 2, got %+v", metrics.Archetypes[0])
	}
	if metrics.Archetypes[0].AvgScore != 4.25 {
		t.Errorf("expected avg score 4.25, got %f", metrics.Archetypes[0].AvgScore)
	}

	// Test WorkModes
	if len(metrics.WorkModes) != 3 {
		t.Fatalf("expected 3 work modes, got %d", len(metrics.WorkModes))
	}

	// Test Locations
	if len(metrics.Locations) != 2 {
		t.Fatalf("expected 2 locations, got %d", len(metrics.Locations))
	}

	// Test Pay Stats
	if metrics.Pay.Count != 4 {
		t.Errorf("expected pay count 4, got %d", metrics.Pay.Count)
	}
	if metrics.Pay.PostedCount != 3 {
		t.Errorf("expected posted count 3, got %d", metrics.Pay.PostedCount)
	}
	if metrics.Pay.EstCount != 1 {
		t.Errorf("expected est count 1, got %d", metrics.Pay.EstCount)
	}
	if metrics.Pay.MaxPayMax != 200000 {
		t.Errorf("expected max pay 200000, got %f", metrics.Pay.MaxPayMax)
	}
	if metrics.Pay.MedianPayMax != 150000 {
		t.Errorf("expected median pay 150000, got %f", metrics.Pay.MedianPayMax)
	}

	// Test Pay Histogram
	if len(metrics.PayHistogram) != 5 {
		t.Fatalf("expected 5 salary histogram bands, got %d", len(metrics.PayHistogram))
	}

	expectedPayCounts := map[string]int{
		"< $100K":       1,
		"$100K - $140K": 1,
		"$140K - $180K": 1,
		"$180K - $220K": 1,
		"$220K+":        0,
	}
	for _, band := range metrics.PayHistogram {
		expectedCount, ok := expectedPayCounts[band.Label]
		if !ok {
			t.Errorf("unexpected pay band label %q", band.Label)
			continue
		}
		if band.Count != expectedCount {
			t.Errorf("PayHistogram[%q].Count = %d; expected %d", band.Label, band.Count, expectedCount)
		}
		expectedPct := float64(expectedCount) / 4.0 * 100.0
		if band.Pct < expectedPct-0.01 || band.Pct > expectedPct+0.01 {
			t.Errorf("PayHistogram[%q].Pct = %f; expected ~%f", band.Label, band.Pct, expectedPct)
		}
	}

	// Test Score Tiers
	if len(metrics.ScoreTiers) == 0 {
		t.Fatalf("expected non-empty ScoreTiers")
	}
	expectedTierCounts := map[string]int{
		"Elite (≥4.5)":       1, // 4.5
		"Strong (4.0-4.4)":   1, // 4.0
		"Moderate (3.0-3.4)": 1, // 3.2
		"Below Bar (<3.0)":   1, // 2.1
	}
	if len(metrics.ScoreTiers) != len(expectedTierCounts) {
		t.Fatalf("expected %d ScoreTiers, got %d: %v", len(expectedTierCounts), len(metrics.ScoreTiers), metrics.ScoreTiers)
	}
	for _, tier := range metrics.ScoreTiers {
		expectedCount, ok := expectedTierCounts[tier.Label]
		if !ok {
			t.Errorf("unexpected ScoreTier label %q", tier.Label)
			continue
		}
		if tier.Count != expectedCount {
			t.Errorf("ScoreTier[%q].Count = %d; expected %d", tier.Label, tier.Count, expectedCount)
		}
		expectedPct := float64(expectedCount) / 4.0 * 100.0
		if tier.Pct < expectedPct-0.01 || tier.Pct > expectedPct+0.01 {
			t.Errorf("ScoreTier[%q].Pct = %f; expected ~%f", tier.Label, tier.Pct, expectedPct)
		}
	}

	// Test Seniority Mix
	if len(metrics.SeniorityMix) == 0 {
		t.Fatalf("expected non-empty SeniorityMix")
	}
	expectedSeniorityCounts := map[string]int{
		"Senior":            1, // Senior Product Manager
		"Staff / Principal": 1, // Staff ML Engineer
		"Junior / Entry":    2, // Junior Machine Learning Engineer, Intern AI Researcher
	}
	if len(metrics.SeniorityMix) != len(expectedSeniorityCounts) {
		t.Fatalf("expected %d SeniorityMix entries, got %d: %v", len(expectedSeniorityCounts), len(metrics.SeniorityMix), metrics.SeniorityMix)
	}
	for _, mix := range metrics.SeniorityMix {
		expectedCount, ok := expectedSeniorityCounts[mix.Label]
		if !ok {
			t.Errorf("unexpected SeniorityMix label %q", mix.Label)
			continue
		}
		if mix.Count != expectedCount {
			t.Errorf("SeniorityMix[%q].Count = %d; expected %d", mix.Label, mix.Count, expectedCount)
		}
		expectedPct := float64(expectedCount) / 4.0 * 100.0
		if mix.Pct < expectedPct-0.01 || mix.Pct > expectedPct+0.01 {
			t.Errorf("SeniorityMix[%q].Pct = %f; expected ~%f", mix.Label, mix.Pct, expectedPct)
		}
	}

	// QualityBarPct: Elite (1) + Strong (1) = 2 out of 4 scored = 50%
	if metrics.QualityBarPct < 49.99 || metrics.QualityBarPct > 50.01 {
		t.Errorf("expected QualityBarPct ~50.0, got %f", metrics.QualityBarPct)
	}
}
