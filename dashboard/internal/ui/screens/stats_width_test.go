package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// statsMetricsWideShape returns metrics whose bars run the full width: the
// 44-count leader is what produces a maximum-width bar, since every other bar
// is scaled to count/maxCount. A fixture where all counts are small yields
// short bars that fit whatever space is left, and hides this bug entirely.
//
// The locations table carries a CJK label longer than the cell so the
// truncation path is exercised in a width the label's rune count alone would
// not catch.
func statsMetricsWideShape() model.StatsMetrics {
	return model.StatsMetrics{
		Archetypes: []model.ArchetypeStat{
			{Label: "AI Solutions & FDE", Count: 44, Pct: 24.6, AvgScore: 3.3},
			{Label: "Applied AI Engineering", Count: 31, Pct: 17.3, AvgScore: 3.6},
			{Label: "ML Platform / Infrastructure", Count: 28, Pct: 15.6, AvgScore: 3.4},
			{Label: "Research Engineering", Count: 12, Pct: 6.7, AvgScore: 3.8},
			{Label: "Other", Count: 2, Pct: 1.1, AvgScore: 0},
		},
		WorkModes: []model.LabelCountStat{
			{Label: "On-site", Count: 162, Pct: 90.5},
			{Label: "Hybrid", Count: 12, Pct: 6.7},
			{Label: "Remote", Count: 5, Pct: 2.8},
		},
		Locations: []model.LabelCountStat{
			{Label: "新竹科學園區 竹科三期", Count: 118, Pct: 65.9},
			{Label: "Taipei, Taiwan", Count: 44, Pct: 24.6},
			{Label: "Tainan, Taiwan", Count: 17, Pct: 9.5},
		},
		Pay: model.PayStats{
			Count: 31, PostedCount: 24, EstCount: 7,
			AvgPayMax: 185000, MedianPayMax: 170000, MaxPayMax: 320000,
		},
		PayHistogram: []model.LabelCountStat{
			{Label: "$100K - $140K", Count: 11, Pct: 35.5},
			{Label: "$140K - $180K", Count: 14, Pct: 45.2},
			{Label: "$220K+", Count: 6, Pct: 19.4},
		},
		ScoreTiers: []model.LabelCountStat{
			{Label: "Strong (4.0-4.4)", Count: 21, Pct: 12.3},
			{Label: "Viable (3.5-3.9)", Count: 58, Pct: 33.9},
			{Label: "Below Bar (<3.0)", Count: 92, Pct: 53.8},
		},
		SeniorityMix: []model.LabelCountStat{
			{Label: "Mid-Level", Count: 151, Pct: 84.4},
			{Label: "Senior", Count: 28, Pct: 15.6},
		},
		QualityBarPct: 12.3,
	}
}

// pieChartW is what a pie panel occupies no matter the terminal: a 17-column
// disc, a 4-column gap, a legend built from a fixed-width label and count cell,
// and the panel's own padding. Nothing in it scales down, which is why
// twoColumnMinWidth has to clear it — and why the sweep cannot assert it at
// widths narrower than this.
const pieChartW = 55

type widthTestPanel struct {
	name  string
	body  string
	avail int
	rows  int // expected line count; 0 when the panel's height is not fixed
	floor int // narrowest column this panel's fixed content can occupy
}

// panelsForWidthTest returns every panel renderBody assembles, paired with the
// column it is placed into: four in the left column, two in the right once the
// terminal reaches twoColumnMinWidth.
func (m StatsModel) panelsForWidthTest() []widthTestPanel {
	left, right := m.contentWidth(), m.rightColumnWidth()
	return []widthTestPanel{
		{"archetypes", m.renderArchetypeChart(), left, 1 + len(m.metrics.Archetypes), archetypeRowFloor},
		{"work modes", m.renderLabelCountTable("Work Mode", m.metrics.WorkModes), left, 1 + len(m.metrics.WorkModes), 0},
		{"locations", m.renderLabelCountTable("Location", m.metrics.Locations), left, 1 + len(m.metrics.Locations), 0},
		{"pay", m.renderPay(), right, 0, 0},
		{"fit quality pie", m.renderPieChart("Fit Quality Distribution", "Quality Breakdown",
			m.metrics.ScoreTiers, []lipgloss.Color{m.theme.Green, m.theme.Sky, m.theme.Red}, true), right, 0, pieChartW},
		{"seniority pie", m.renderPieChart("Seniority Mix", "Seniority Mix",
			m.metrics.SeniorityMix, []lipgloss.Color{m.theme.Mauve, m.theme.Peach}, false), right, 0, pieChartW},
	}
}

// Every line a stats panel renders must fit the column it is placed into.
//
// renderBody puts its panels inside lipgloss boxes roughly half the terminal
// wide, but the panels used to size their label and bar columns off the
// *terminal* width. The row then came out wider than the box holding it, so
// lipgloss wrapped it — and the wrapped remainder starts at column 0, losing
// the panel's indent and colliding with the neighbouring column.
//
// The row-count assertion is the load-bearing half. Wrapping makes lines
// *narrower*, not wider, so a width-only check passes straight through the
// defect it is meant to catch; only counting the rows proves nothing wrapped.
//
// The sweep covers both sides of the two-column threshold and both sides of
// 158, where the old fixed budget starts fitting on its own. The single-column
// layout is not exempt: at 60 columns the archetype row came to 61, so the whole
// screen rendered one column wider than the terminal. It stops at 50 because
// below that each panel hits a floor no bar budget can move — see
// TestStatsArchetypeRowFloor.
func TestStatsPanelsFitTheirColumn(t *testing.T) {
	metrics := statsMetricsWideShape()

	for _, width := range []int{50, 60, 70, 80, 100, 113, 114, 120, 140, 157, 158, 200} {
		m := makeStatsModel(t, width, 40, metrics)

		for _, panel := range m.panelsForWidthTest() {
			if panel.avail < panel.floor {
				continue // fixed content that no budget can shrink; see the floor tests
			}
			lines := strings.Split(panel.body, "\n")

			for i, line := range lines {
				if got := lipgloss.Width(line); got > panel.avail {
					t.Errorf("terminal %d: %s line %d measured %d columns, but its column is only %d wide",
						width, panel.name, i, got, panel.avail)
				}
			}

			if panel.rows > 0 && len(lines) != panel.rows {
				t.Errorf("terminal %d: %s rendered %d lines, want %d — a row wrapped and lost its indent",
					width, panel.name, len(lines), panel.rows)
			}

			if panel.name == "archetypes" && !strings.Contains(panel.body, "█") {
				t.Errorf("terminal %d: the bar column was squeezed to nothing", width)
			}
		}
	}
}

// archetypeRowFloor is the narrowest terminal an archetype row can still fit:
// the padding, label, count, score and the two gaps around the bar leave
// exactly one column for a one-glyph bar. Below it the row is knowingly allowed
// to overflow — the alternative is a chart with no bar at all, the same trade
// pipeline.go's role floor makes.
const archetypeRowFloor = panelPadW + 20 + archetypeCountW + 2*barGapW + archetypeScoreW + 1

// Pin the floor so a change to any fixed cell cannot move it unnoticed: one
// column narrower must overflow, and the floor itself must not.
func TestStatsArchetypeRowFloor(t *testing.T) {
	metrics := statsMetricsWideShape()

	widest := func(width int) int {
		m := makeStatsModel(t, width, 40, metrics)
		w := 0
		for _, line := range strings.Split(m.renderArchetypeChart(), "\n") {
			w = max(w, lipgloss.Width(line))
		}
		return w
	}

	if got := widest(archetypeRowFloor); got != archetypeRowFloor {
		t.Errorf("at the floor (%d) the widest row measured %d, want exactly %d",
			archetypeRowFloor, got, archetypeRowFloor)
	}
	if got := widest(archetypeRowFloor - 1); got <= archetypeRowFloor-1 {
		t.Errorf("one column below the floor the row measured %d, so the floor is not where the constants say it is",
			got)
	}
}

// A label wider than its cell must be cut to the cell's *display* width. Cutting
// by rune count instead lets a CJK label — two columns per rune — pass the guard
// untouched and overflow, which is the same wrap this file exists to prevent.
func TestStatsLabelsTruncateByDisplayWidth(t *testing.T) {
	const cjk = "新竹科學園區 竹科三期" // 11 runes, 21 columns

	m := makeStatsModel(t, 200, 40, model.StatsMetrics{
		WorkModes: []model.LabelCountStat{{Label: cjk, Count: 10, Pct: 100}},
	})

	if lipgloss.Width(cjk) <= labelCountW {
		t.Fatalf("fixture no longer exceeds the %d-column cell; pick a wider label", labelCountW)
	}

	lines := strings.Split(m.renderLabelCountTable("Work Mode", m.metrics.WorkModes), "\n")
	if len(lines) != 2 {
		t.Fatalf("rendered %d lines, want 2 (title + one row) — the label wrapped", len(lines))
	}
}

// A single archetype takes 100% of the pipeline, and "100" is one column wider
// than the count cell's nominal width. The cell has to grow to match, or it
// wraps and splits the row.
func TestStatsArchetypeCountCellFitsAFullShare(t *testing.T) {
	m := makeStatsModel(t, 200, 40, model.StatsMetrics{
		Archetypes: []model.ArchetypeStat{{Label: "AI Solutions & FDE", Count: 44, Pct: 100, AvgScore: 3.3}},
	})

	lines := strings.Split(m.renderArchetypeChart(), "\n")
	if len(lines) != 2 {
		t.Errorf("rendered %d lines, want 2 (title + one row) — the 100%% count cell wrapped", len(lines))
	}
}
