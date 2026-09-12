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
		postedOn string
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
		{
			name: "remote EU with EUR estimate range",
			app: model.CareerApplication{
				Date:  "2026-06-10",
				Notes: "Remote EU (Portugal eligible). Comp ~€130-170K (est). Applied 2026-06-10",
			},
			location: "",
			workMode: "Remote",
			payRange: "~€130-170K",
			paySrc:   "est",
			last:     "2026-06-10",
		},
		{
			name: "international city hybrid with EUR posted",
			app: model.CareerApplication{
				Date:  "2026-06-09",
				Notes: "Berlin (Hybrid). Base €90-110K (POSTED). Via Greenhouse",
			},
			location: "Berlin",
			workMode: "Hybrid",
			payRange: "€90-110K",
			paySrc:   "POSTED",
			last:     "2026-06-09",
		},
		{
			name: "CHF range, bare intl city implies onsite",
			app: model.CareerApplication{
				Date:  "2026-06-08",
				Notes: "Zurich. CHF 165-185K. Check Point-backed",
			},
			location: "Zurich",
			workMode: "Full",
			payRange: "CHF 165-185K",
			paySrc:   "",
			last:     "2026-06-08",
		},
		{
			name: "GBP posted range, London",
			app: model.CareerApplication{
				Date:  "2026-06-07",
				Notes: "London. £175-225K (POSTED). 30+ teams",
			},
			location: "London",
			workMode: "Full",
			payRange: "£175-225K",
			paySrc:   "POSTED",
			last:     "2026-06-07",
		},
		{
			name: "Portugal home market, city from role title",
			app: model.CareerApplication{
				Date:  "2026-06-06",
				Role:  "Senior Engineering Manager — Porto",
				Notes: "Onsite. Comp €60-90K (est, below floor)",
			},
			location: "Porto",
			workMode: "Full",
			payRange: "€60-90K",
			paySrc:   "est",
			last:     "2026-06-06",
		},
		{
			name: "Poland hybrid with PLN estimate",
			app: model.CareerApplication{
				Date:  "2026-06-11",
				Notes: "Warsaw (Hybrid). Comp ~PLN 150-200K (est). Via LinkedIn",
			},
			location: "Warsaw",
			workMode: "Hybrid",
			payRange: "~PLN 150-200K",
			paySrc:   "est",
			last:     "2026-06-11",
		},
		{
			name: "Poland onsite with zł posted",
			app: model.CareerApplication{
				Date:  "2026-06-12",
				Notes: "Krakow. Base zł 120-160K (POSTED)",
			},
			location: "Krakow",
			workMode: "Full",
			payRange: "zł 120-160K",
			paySrc:   "POSTED",
			last:     "2026-06-12",
		},
		{
			name: "Symmetry test: PLN suffix range",
			app: model.CareerApplication{
				Date:  "2026-06-13",
				Notes: "Warsaw. Comp 150-200K PLN (est)",
			},
			location: "Warsaw",
			workMode: "Full",
			payRange: "150-200K PLN",
			paySrc:   "est",
			last:     "2026-06-13",
		},
		{
			// Confirms bare symbols share suffix behaviour (regression test only covers ISO).
			name: "suffix form with bare symbol",
			app: model.CareerApplication{
				Date:  "2026-06-15",
				Notes: "Berlin. Comp 90-110K € (POSTED)",
			},
			location: "Berlin",
			workMode: "Full",
			payRange: "90-110K €",
			paySrc:   "POSTED",
			last:     "2026-06-15",
		},
		{
			// Suffix branch with a full range, not just lone amount + currency.
			name: "suffix-form range with K on both sides",
			app: model.CareerApplication{
				Date:  "2026-06-16",
				Notes: "Krakow. Base 120K-160K PLN (est)",
			},
			location: "Krakow",
			workMode: "Full",
			payRange: "120K-160K PLN",
			paySrc:   "est",
			last:     "2026-06-16",
		},
		{
			name: "valuation and funding figures are not pay",
			app: model.CareerApplication{
				Date:  "2026-07-16",
				Notes: "Series C, $600M valuation (not pay) — real hiring signal; $70M Series C closed 8mo ago; $124M total raised; advertised comp range is broken data, confirm real number",
			},
			payRange: "",
			last:     "2026-07-16",
		},
		{
			name: "pay range still wins over an adjacent valuation figure",
			app: model.CareerApplication{
				Date:  "2026-06-08",
				Notes: "$7.6B valuation, Remote. $122-149K (POSTED)",
			},
			workMode: "Remote",
			payRange: "$122-149K",
			paySrc:   "POSTED",
			last:     "2026-06-08",
		},
		{
			name: "billion-scale valuation alone is not pay",
			app: model.CareerApplication{
				Date:  "2026-04-11",
				Notes: "Series H drone logistics, $7.6B valuation, Remote Canada",
			},
			workMode: "Remote",
			payRange: "",
			last:     "2026-04-11",
		},
		{
			name: "posted date populates PostedOn without becoming last contact",
			app: model.CareerApplication{
				Date:  "2026-08-06",
				Notes: "Santa Clara, CA; posted 2026-08-07",
			},
			location: "Santa Clara, CA",
			workMode: "Full",
			last:     "2026-08-06",
			postedOn: "2026-08-07",
		},
		{
			name: "a real interaction still wins last contact over the posting date",
			app: model.CareerApplication{
				Date:  "2026-06-01",
				Notes: "Austin, TX; Posted: 2026-05-20. Recruiter screen 2026-06-14",
			},
			location: "Austin, TX",
			workMode: "Full",
			last:     "2026-06-14",
			postedOn: "2026-05-20",
		},
		{
			name: "the POSTED pay marker carries no date and sets no PostedOn",
			app: model.CareerApplication{
				Date:  "2026-06-04",
				Notes: "Remote US. Base $174,986-209,983 (POSTED)",
			},
			workMode: "Remote",
			payRange: "$174,986-209,983",
			paySrc:   "POSTED",
			last:     "2026-06-04",
		},
		{
			// The regression the segment anchor exists to prevent. With a
			// word-boundary match this date was read as posting metadata AND
			// stripped from the last-contact scan, so a recruiter interaction
			// that really happened vanished and the row fell back to its applied
			// date. Prose is not a segment: "posted" mid-sentence stays contact.
			name: "prose \"posted\" is a real interaction, not posting metadata",
			app: model.CareerApplication{
				Date:  "2026-06-01",
				Notes: "Recruiter posted 2026-07-20 update on the req",
			},
			last: "2026-07-20",
		},
		{
			name: "a posting segment is still read when the note leads with it",
			app: model.CareerApplication{
				Date:  "2026-06-01",
				Notes: "posted 2026-05-11 | Remote US",
			},
			workMode: "Remote",
			last:     "2026-06-01",
			postedOn: "2026-05-11",
		},
		{
			// Edge 1 of the two the review asked to pin: the colon form with no
			// space. It is unambiguously a segment, so it must populate PostedOn
			// — and, having done so, must not also count as contact.
			name: "posted:<date> with no space is a posting segment",
			app: model.CareerApplication{
				Date:  "2026-06-01",
				Notes: "Remote US; posted:2026-07-15",
			},
			workMode: "Remote",
			last:     "2026-06-01",
			postedOn: "2026-07-15",
		},
		{
			// The bare form requires a space, so this sets no PostedOn. It is
			// not contact either — reISODate needs a word boundary the welded
			// "posted2026" does not give it — so the row keeps its applied date
			// and the malformed token is inert on both paths.
			name: "\"posted\" welded to the date is inert, not a segment",
			app: model.CareerApplication{
				Date:  "2026-06-01",
				Notes: "Remote US; posted2026-07-15",
			},
			workMode: "Remote",
			last:     "2026-06-01",
		},
		{
			// Edge 2: two posting dates in one note. A re-post replaces the req,
			// so the column has to show the live one — the first match would pin
			// the row to a requisition that no longer exists.
			name: "with two posting dates the most recent one wins",
			app: model.CareerApplication{
				Date:  "2026-06-01",
				Notes: "posted: 2026-03-02 | reposted; posted: 2026-07-19",
			},
			last:     "2026-06-01",
			postedOn: "2026-07-19",
		},
		{
			name: "stripping a posting segment cannot weld its neighbours together",
			app: model.CareerApplication{
				Date:  "2026-06-01",
				Notes: "Austin, TX; posted: 2026-05-20; screen 2026-06-14",
			},
			location: "Austin, TX",
			workMode: "Full",
			last:     "2026-06-14",
			postedOn: "2026-05-20",
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
			if tc.app.PostedOn != tc.postedOn {
				t.Errorf("PostedOn = %q, want %q", tc.app.PostedOn, tc.postedOn)
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
		"€130-170K":        170_000,
		"£175-225K":        225_000,
		"CHF 165-185K":     185_000,
		"PLN 150-200K":     200_000,
		"zł 120-160K":      160_000,
		"150-200K PLN":     200_000,
		"165-185K CHF":     185_000,
		"120K €":           120_000,
		"80-120K UAH":      120_000,
		"$7.6B":            7_600_000_000,
		"":                 0,
	}
	for span, want := range cases {
		if got := payCeiling(span); got != want {
			t.Errorf("payCeiling(%q) = %v, want %v", span, got, want)
		}
	}
}

// TestBuildMoneySpanRegex pins builder output shape independent of production currencyTokens.
func TestBuildMoneySpanRegex(t *testing.T) {
	cases := []struct {
		name    string
		input   []string
		wantPat string
	}{
		{
			name:    "single bare symbol ($)",
			input:   []string{"$"},
			wantPat: `~?(?:(?:\$)\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?(?:\s*[-–]\s*(?:\$)?\d[\d,]*(?:\.\d+)?[KkMmBb]?)?|\d[\d,]*(?:\.\d+)?[KkMmBb]?(?:\s*[-–]\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?)?\s+(?:\$))`,
		},
		{
			name:    "single ISO code (PLN)",
			input:   []string{"PLN"},
			wantPat: `~?(?:(?:PLN ?)\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?(?:\s*[-–]\s*(?:PLN ?)?\d[\d,]*(?:\.\d+)?[KkMmBb]?)?|\d[\d,]*(?:\.\d+)?[KkMmBb]?(?:\s*[-–]\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?)?\s+(?:PLN))`,
		},
		{
			name:    "two ISO codes (PLN, UAH)",
			input:   []string{"PLN", "UAH"},
			wantPat: `~?(?:(?:PLN ?|UAH ?)\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?(?:\s*[-–]\s*(?:PLN ?|UAH ?)?\d[\d,]*(?:\.\d+)?[KkMmBb]?)?|\d[\d,]*(?:\.\d+)?[KkMmBb]?(?:\s*[-–]\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?)?\s+(?:PLN|UAH))`,
		},
		{
			name:    "mixed bare + ISO ($ bare, PLN ISO)",
			input:   []string{"$", "PLN"},
			wantPat: `~?(?:(?:\$|PLN ?)\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?(?:\s*[-–]\s*(?:\$|PLN ?)?\d[\d,]*(?:\.\d+)?[KkMmBb]?)?|\d[\d,]*(?:\.\d+)?[KkMmBb]?(?:\s*[-–]\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?)?\s+(?:\$|PLN))`,
		},
		{
			name:    "metachar token (escaped via QuoteMeta)",
			input:   []string{"A.B"},
			wantPat: `~?(?:(?:A\.B ?)\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?(?:\s*[-–]\s*(?:A\.B ?)?\d[\d,]*(?:\.\d+)?[KkMmBb]?)?|\d[\d,]*(?:\.\d+)?[KkMmBb]?(?:\s*[-–]\s*\d[\d,]*(?:\.\d+)?[KkMmBb]?)?\s+(?:A\.B))`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			re := buildMoneySpanRegex(tc.input)
			if got := re.String(); got != tc.wantPat {
				t.Errorf("buildMoneySpanRegex(%v).String() =\n  %q\nwant:\n  %q", tc.input, got, tc.wantPat)
			}
		})
	}
}

func TestBuildMoneySpanRegex_EmptyMatchesNothing(t *testing.T) {
	re := buildMoneySpanRegex([]string{})
	for _, s := range []string{"150-200K", "$200K", "1,000", "PLN 100K", "€130-170K"} {
		if got := re.FindString(s); got != "" {
			t.Errorf("empty slice matched %q in %q; want no match", got, s)
		}
	}
}

func TestBuildMoneySpanRegex_SuffixNoTrailingSpace(t *testing.T) {
	re := buildMoneySpanRegex(currencyTokens)
	cases := []struct {
		name, input string
	}{
		{"PLN before paren", "Warsaw. Comp 150-200K PLN (est)"},
		{"CHF before period", "Zurich. 165-185K CHF."},
		{"EUR before period", "Berlin. 90-110K EUR."},
		{"UAH before paren", "Kyiv. 80-120K UAH (POSTED)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := re.FindString(tc.input)
			if got == "" {
				t.Fatalf("no match for %q", tc.input)
			}
			if got[len(got)-1] == ' ' {
				t.Errorf("matched span %q has trailing space", got)
			}
		})
	}
}

func TestIsBareSymbol(t *testing.T) {
	cases := []struct {
		tok  string
		want bool
	}{
		// Current bare symbols in currencyTokens
		{"$", true}, {"€", true}, {"£", true}, {"zł", true}, {"₴", true},
		// Current ISO codes in currencyTokens
		{"CHF", false}, {"EUR", false}, {"USD", false}, {"GBP", false}, {"PLN", false}, {"UAH", false},
		// Plausible future additions
		{"¥", true}, {"₹", true}, {"kr", true}, {"R$", false},
		{"JPY", false}, {"INR", false}, {"SEK", false}, {"BRL", false},
		// Edge cases
		{"", true},
		{"A.B", false},
		{"Chf", false},
		{"123", true},
	}
	for _, tc := range cases {
		if got := isBareSymbol(tc.tok); got != tc.want {
			t.Errorf("isBareSymbol(%q) = %v, want %v", tc.tok, got, tc.want)
		}
	}
}
