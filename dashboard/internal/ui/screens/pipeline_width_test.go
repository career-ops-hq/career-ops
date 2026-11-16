package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// A rendered pipeline row must measure exactly the width it was given, in every
// combination of optional columns that still fits.
//
// The overhead used to be a fixed 14, the value for all optional columns
// visible. Narrower layouts were billed for separators they never rendered.
// Sweeping all 2^7 combinations rather than the two endpoints is deliberate:
// an off-by-one that only appears at a particular count is invisible to an
// endpoint check. When the requested columns cannot fit, columnWidths drops
// them until the row lands on the terminal width.
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
		HasScore:    true,
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

			// Below the point where even the shrunk columns fit, the row can no
			// longer land on the terminal width. Those widths are covered by
			// TestNarrowTerminalFallsBackToTheRoleFloor. Everywhere the fitter
			// still has room, the row is exactly the width it was given.
			if m.columnWidths().role <= 6 {
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

// At 60 columns the default date, location, and pay columns do not fit beside
// a readable role. They drop, and the row that remains is exactly one line of
// the terminal width rather than a wrapped overflow.
func TestNarrowTerminalFallsBackToTheRoleFloor(t *testing.T) {
	m := PipelineModel{
		width:       60,
		theme:       theme.NewTheme(""),
		visibleCols: map[ColumnID]bool{ColDate: true, ColLocation: true, ColPay: true},
	}
	cw := m.columnWidths()
	if cw.date != 0 || cw.loc != 0 || cw.pay != 0 {
		t.Fatalf("optional columns stayed visible at width 60: %+v", cw)
	}
	if cw.role < 6 {
		t.Fatalf("role width = %d, want at least the lowered floor of 6", cw.role)
	}
	app := model.CareerApplication{
		Number: 1, Company: "Fernhollow Labs", Role: "Platform Engineer",
		Status: "Evaluated", Score: 4.2, HasScore: true,
		Date: "2026-08-01", Location: "Remote", PayRange: "$140k-$175k",
	}
	line := m.renderAppLine(app, true)
	if strings.Contains(line, "\n") {
		t.Fatalf("selected row wrapped: %q", line)
	}
	if got := lipgloss.Width(line); got != 60 {
		t.Fatalf("selected row width = %d, want 60", got)
	}
}
