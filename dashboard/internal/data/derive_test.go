package data

import (
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

func TestDeriveNoteFields(t *testing.T) {
	cases := []struct {
		name     string
		app      model.CareerApplication
		location string
		workMode string
		payRange string
		paySrc   string
		last     string
	}{
		{
			name: "remote with posted comma range and rejection date",
			app: model.CareerApplication{
				Date:  "2026-06-04",
				Notes: "Remote US (EST/CST). Base $174,986-209,983 + RSUs (POSTED). Rejected 2026-06-05 (not moving forward). Via Greenhouse",
			},
			workMode: "Remote",
			payRange: "$174,986-209,983",
			paySrc:   "POSTED",
			last:     "2026-06-05",
		},
		{
			name: "hybrid city state with estimate",
			app: model.CareerApplication{
				Date:  "2026-06-03",
				Notes: "Charlotte NC (Hybrid), via LinkedIn. Comp ~$130-170K (est). Application VIEWED by recruiter 2026-06-04",
			},
			location: "Charlotte, NC",
			workMode: "Hybrid",
			payRange: "~$130-170K",
			paySrc:   "est",
			last:     "2026-06-04",
		},
		{
			name: "bare location implies full onsite, decimal K range",
			app: model.CareerApplication{
				Date:  "2026-06-01",
				Notes: "Austin TX (location mismatch). Salary $124.2-198.7K (POSTED)",
			},
			location: "Austin, TX",
			workMode: "Full",
			payRange: "$124.2-198.7K",
			paySrc:   "POSTED",
			last:     "2026-06-01",
		},
		{
			name: "lone amount fallback when no range, date falls back to applied",
			app: model.CareerApplication{
				Date:  "2026-06-02",
				Notes: "Via LinkedIn (recruiting agency). Sam stated $170K min floor",
			},
			workMode: "",
			payRange: "$170K",
			last:     "2026-06-02",
		},
		{
			name: "range preferred over earlier lone amount",
			app: model.CareerApplication{
				Date:  "2026-05-31",
				Notes: "Comp $100-175K base + 10% bonus + $300 health credit (recruiter-confirmed). Phone screen DONE 2026-06-03",
			},
			payRange: "$100-175K",
			last:     "2026-06-03",
		},
		{
			name: "city falls back to role title, timezone parens are not an estimate",
			app: model.CareerApplication{
				Date:  "2026-05-31",
				Role:  "Sr Software Engineer, Enterprise Systems — Charlotte, NC",
				Notes: "Referral via friend. Remote US (EST/CST). Comp $100-175K base (recruiter-confirmed)",
			},
			location: "Charlotte, NC",
			workMode: "Remote",
			payRange: "$100-175K",
			paySrc:   "",
			last:     "2026-05-31",
		},
		{
			name: "marketing role and interest prose are not estimate markers",
			app: model.CareerApplication{
				Date:  "2026-06-01",
				Role:  "Product Marketing Manager",
				Notes: "Strong fit (AI-augmented interest). Salary $140-180K. Via Lever",
			},
			payRange: "$140-180K",
			paySrc:   "",
			last:     "2026-06-01",
		},
		{
			name: "no false-positive city from prose",
			app: model.CareerApplication{
				Date:  "2026-06-01",
				Notes: "Strong fit for Sams AI-augmented edge. Rejected by recruiter Nadia Kong",
			},
			location: "",
			workMode: "",
			last:     "2026-06-01",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			deriveNoteFields(&tc.app)
			if want := payCeiling(tc.payRange); tc.app.PayMax != want {
				t.Errorf("PayMax = %v, want %v", tc.app.PayMax, want)
			}
			if tc.app.Location != tc.location {
				t.Errorf("Location = %q, want %q", tc.app.Location, tc.location)
			}
			if tc.app.WorkMode != tc.workMode {
				t.Errorf("WorkMode = %q, want %q", tc.app.WorkMode, tc.workMode)
			}
			if tc.app.PayRange != tc.payRange {
				t.Errorf("PayRange = %q, want %q", tc.app.PayRange, tc.payRange)
			}
			if tc.app.PaySource != tc.paySrc {
				t.Errorf("PaySource = %q, want %q", tc.app.PaySource, tc.paySrc)
			}
			if tc.app.LastContact != tc.last {
				t.Errorf("LastContact = %q, want %q", tc.app.LastContact, tc.last)
			}
		})
	}
}

func TestPayCeiling(t *testing.T) {
	cases := map[string]float64{
		"$140-210K":        210_000,
		"$174,986-209,983": 209_983,
		"~$124.2-198.7K":   198_700,
		"$170K":            170_000,
		"$95-159K":         159_000,
		"":                 0,
	}
	for span, want := range cases {
		if got := payCeiling(span); got != want {
			t.Errorf("payCeiling(%q) = %v, want %v", span, got, want)
		}
	}
}
