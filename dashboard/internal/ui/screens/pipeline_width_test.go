package screens

import (
	"testing"

	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// A rendered pipeline row must measure exactly the width it was given, in every
// combination of optional columns.
//
// The overhead used to be a fixed 14 — the value for all optional columns
// visible. Every narrower layout was therefore billed for separators it never
// rendered and came out short: at width 200 with no optional columns the row
// measured 193, growing one rune per column turned on until the full layout hit
// 200 exactly. Adding an eighth column to that constant-based budget would have
// taken it past the edge.
//
// Sweeping all 2^7 combinations rather than the two endpoints is deliberate: an
// off-by-one that only appears at a particular count (say, exactly one optional
// column) is invisible to an endpoint check.
func TestRowWidthMatchesTerminalWidthForEveryColumnCombination(t *testing.T) {
	optional := getOptionalCols()
	if len(optional) != 7 {
		t.Fatalf("expected 7 optional columns, got %d — update the sweep below", len(optional))
	}

	app := model.CareerApplication{
		Number:      42,
		Date:        "2026-08-07",
		Company:     "Acme Corporation",
		Role:        "Senior Backend Engineer",
		Status:      "Applied",
		Score:       4.2,
		Location:    "Santa Clara, CA",
		WorkMode:    "Remote",
		PayRange:    "$174,986-209,983",
		PaySource:   "POSTED",
		PostedOn:    "2026-08-01",
		LastContact: "2026-08-06",
		ReportPath:  "reports/042-acme.md",
	}

	for _, width := range []int{120, 160, 200, 240} {
		for mask := 0; mask < 1<<7; mask++ {
			visible := map[ColumnID]bool{}
			for i, col := range optional {
				visible[col.id] = mask&(1<<i) != 0
			}

			m := PipelineModel{
				width:       width,
				theme:       theme.NewTheme(""),
				visibleCols: visible,
			}

			// Once the fixed columns alone exhaust the width, role clamps to its
			// floor of 15 and the row is deliberately allowed to overflow —
			// showing a 3-rune role stub would be worse than wrapping. The
			// width budget is only meaningful above that crossover, so those
			// combinations are covered by TestNarrowTerminalFallsBackToTheRoleFloor
			// instead of being asserted here.
			if m.columnWidths().role <= 15 {
				continue
			}

			got := lipgloss.Width(m.renderAppLine(app, false))
			if got != width {
				on := 0
				for _, v := range visible {
					if v {
						on++
					}
				}
				t.Errorf("width %d with %d optional column(s) (mask %07b): row measured %d, want %d",
					width, on, mask, got, width)
			}
		}
	}
}

// The role column is what absorbs the remaining space, and it has a floor of 15.
// Below a certain terminal width the fixed columns alone exceed the budget, and
// the row is then allowed to be wider than the terminal — that is the floor
// doing its job, not the overhead being wrong. This pins where that crossover
// is so a change to the fixed widths cannot quietly move it.
func TestNarrowTerminalFallsBackToTheRoleFloor(t *testing.T) {
	m := PipelineModel{
		width:       60,
		theme:       theme.NewTheme(""),
		visibleCols: map[ColumnID]bool{ColDate: true, ColLocation: true, ColPay: true},
	}

	if got := m.columnWidths().role; got != 15 {
		t.Errorf("role width = %d, want the floor of 15", got)
	}
}
