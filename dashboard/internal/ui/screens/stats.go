package screens

import (
	"fmt"
	"math"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// StatsClosedMsg is emitted when the stats screen is dismissed.
type StatsClosedMsg struct{}

// StatsModel implements the dimension-breakdown analytics screen (archetype,
// work mode, location, pay histogram, score tier pie chart, and automated insights),
// complementing the funnel/rate-focused Progress screen with high-signal visual charts.
type StatsModel struct {
	metrics      model.StatsMetrics
	evaluated    int
	scrollOffset int
	width        int
	height       int
	theme        theme.Theme
}

// NewStatsModel creates a new stats screen.
func NewStatsModel(t theme.Theme, metrics model.StatsMetrics, evaluated, width, height int) StatsModel {
	return StatsModel{
		metrics:   metrics,
		evaluated: evaluated,
		width:     width,
		height:    height,
		theme:     t,
	}
}

// Init implements tea.Model.
func (m StatsModel) Init() tea.Cmd {
	return nil
}

// Resize updates dimensions.
func (m *StatsModel) Resize(width, height int) {
	m.width = width
	m.height = height
}

// Update processes navigation and input events for the stats analytics dashboard.
func (m StatsModel) Update(msg tea.Msg) (StatsModel, tea.Cmd) {
	switch keyEvent := msg.(type) {
	case tea.KeyMsg:
		switch keyEvent.String() {
		case "q", "esc":
			return m, func() tea.Msg { return StatsClosedMsg{} }
		case "t", "T":
			return m, nil // Toggle handled at app level
		case "j", "down":
			m.scrollOffset = m.scrollOffset + 1
		case "k", "up":
			m.scrollOffset = max(0, m.scrollOffset-1)
		case "pgdown", "ctrl+d":
			m.scrollOffset += m.height / 2
		case "pgup", "ctrl+u":
			m.scrollOffset = max(0, m.scrollOffset-m.height/2)
		} // end inner key switch
		// Clamp against the full untruncated body height so panels beyond
		// the first screen-full remain reachable regardless of terminal size.
		// Using m.View() would measure the already-truncated render and
		// produce a maxOffset of ~2, making content below the fold unreachable.
		contentLines := strings.Count(m.renderBody(), "\n") + 1
		maxOffset := contentLines - (m.height - 4)
		if maxOffset < 0 {
			maxOffset = 0
		}
		if m.scrollOffset > maxOffset {
			m.scrollOffset = maxOffset
		}
	case tea.WindowSizeMsg:
		m.width, m.height = keyEvent.Width, keyEvent.Height
	} // end outer msg switch
	return m, nil
}

// renderBody builds the full untruncated body string used both by View (for
// display after slicing) and by Update (to measure true content height for
// scroll clamping). Keeping it separate prevents Update from measuring the
// already-truncated View output, which previously capped maxOffset at ~2.
func (m StatsModel) renderBody() string {
	insights := m.renderInsights()
	archetypes := m.renderArchetypeChart()
	// showQualityBadge=true for the Fit Quality pie (score metric belongs there),
	// false for Seniority Mix (the badge would be semantically meaningless).
	pieChart := m.renderPieChart(i18n.Current.FitQualityDistribution, i18n.Current.QualityBreakdown, m.metrics.ScoreTiers, []lipgloss.Color{
		m.theme.Green,  // Elite (>=4.5)
		m.theme.Sky,    // Strong (4.0-4.4)
		m.theme.Yellow, // Viable (3.5-3.9)
		m.theme.Peach,  // Moderate (3.0-3.4)
		m.theme.Red,    // Below Bar (<3.0)
		m.theme.Mauve,
	}, true)
	seniorityPieChart := m.renderPieChart(i18n.Current.SeniorityMix, i18n.Current.SeniorityMix, m.metrics.SeniorityMix, []lipgloss.Color{
		m.theme.Mauve,
		m.theme.Peach,
		m.theme.Sky,
		m.theme.Green,
		m.theme.Yellow,
		m.theme.Red,
	}, false)
	workModes := m.renderLabelCountTable(i18n.Current.WorkModeTitle, m.metrics.WorkModes)
	locations := m.renderLabelCountTable(i18n.Current.LocationTitle, m.metrics.Locations)
	pay := m.renderPay()

	if m.width >= 110 {
		leftColWidth := m.width/2 - 2
		rightColWidth := m.width - leftColWidth - 4

		leftCol := lipgloss.NewStyle().Width(leftColWidth).Render(
			lipgloss.JoinVertical(lipgloss.Left,
				insights,
				"",
				archetypes,
				"",
				workModes,
				"",
				locations,
			),
		)

		rightCol := lipgloss.NewStyle().Width(rightColWidth).Render(
			lipgloss.JoinVertical(lipgloss.Left,
				pieChart,
				"",
				seniorityPieChart,
				"",
				pay,
			),
		)

		return lipgloss.JoinVertical(lipgloss.Left,
			"",
			lipgloss.JoinHorizontal(lipgloss.Top, leftCol, "  ", rightCol),
			"",
		)
	}
	// Single-column stacked layout on smaller terminals
	return lipgloss.JoinVertical(lipgloss.Left,
		"",
		insights,
		"",
		pieChart,
		"",
		seniorityPieChart,
		"",
		archetypes,
		"",
		workModes,
		"",
		locations,
		"",
		pay,
		"",
	)
}

// View renders the stats screen.
func (m StatsModel) View() string {
	header := m.renderHeader()
	help := m.renderHelp()
	body := m.renderBody()

	bodyLines := strings.Split(body, "\n")
	offset := m.scrollOffset
	if offset >= len(bodyLines) {
		offset = len(bodyLines) - 1
	}
	if offset < 0 {
		offset = 0
	}
	if offset > 0 {
		bodyLines = bodyLines[offset:]
	}

	availHeight := m.height - 4 // header + help + padding
	if availHeight < 3 {
		availHeight = 3
	}
	if len(bodyLines) > availHeight {
		bodyLines = bodyLines[:availHeight]
	}

	body = strings.Join(bodyLines, "\n")

	return lipgloss.JoinVertical(lipgloss.Left, header, body, help)
}

func (m StatsModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Mauve).Render("📊 " + i18n.Current.StatsTitle)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	info := right.Render(fmt.Sprintf(i18n.Current.StatsSummary, m.evaluated, len(m.metrics.Archetypes)))

	gap := m.width - lipgloss.Width(title) - lipgloss.Width(info) - 4
	if gap < 1 {
		gap = 1
	}

	return style.Render(title + strings.Repeat(" ", gap) + info)
}

func (m StatsModel) renderInsights() string {
	insightsList := data.GenerateInsights(m.metrics)
	if len(insightsList) == 0 {
		return ""
	}
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	sectionTitle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Yellow).Render("💡 " + i18n.Current.StatsStrategicInsights)

	boxW := m.width - 6
	if m.width >= 110 {
		boxW = m.width/2 - 6
	}

	boxStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(m.theme.Overlay).
		Padding(0, 1).
		Width(boxW)

	var bulletLines []string
	bulletLines = append(bulletLines, sectionTitle)
	for _, ins := range insightsList {
		bullet := lipgloss.NewStyle().Foreground(m.theme.Sky).Render("• ")
		text := lipgloss.NewStyle().Foreground(m.theme.Text).Render(ins)
		bulletLines = append(bulletLines, bullet+text)
	}

	return padStyle.Render(boxStyle.Render(strings.Join(bulletLines, "\n")))
}

// renderPieChart draws a high-definition radial terminal pie chart with aspect ratio correction and legend.
// showQualityBadge controls whether the ">=4.0 quality bar" summary badge is appended to the legend;
// it should be true only for the Fit Quality Distribution chart (where the metric is meaningful)
// and false for the Seniority Mix chart (where it would be semantically out of place).
func (m StatsModel) renderPieChart(title, legendHeading string, stats []model.LabelCountStat, sliceColors []lipgloss.Color, showQualityBadge bool) string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	sectionTitle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Mauve).Render(i18n.PieChartSectionTitle(title))
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	if len(stats) == 0 {
		return padStyle.Render(sectionTitle + "\n" + dimStyle.Render(i18n.Current.NoData))
	}

	totalCount := 0
	for _, s := range stats {
		totalCount += s.Count
	}
	if totalCount == 0 {
		return padStyle.Render(sectionTitle + "\n" + dimStyle.Render(i18n.Current.NoData))
	}

	// Calculate cumulative boundaries [0.0 ... 1.0]
	cumFractions := make([]float64, len(stats))
	cum := 0.0
	for i, s := range stats {
		cum += float64(s.Count) / float64(totalCount)
		cumFractions[i] = cum
	}

	// Draw radial pie chart: Radius = 4 (Grid height = 9, width = 17)
	radius := 4
	var pieLines []string
	for y := -radius; y <= radius; y++ {
		var row strings.Builder
		for x := -2 * radius; x <= 2 * radius; x++ {
			nx := float64(x) / 2.0 // correct for 2:1 character aspect ratio
			ny := float64(y)
			dist := math.Sqrt(nx*nx + ny*ny)

			if dist <= float64(radius)+0.2 {
				// Clockwise angle starting from top (12 o'clock)
				angle := math.Atan2(nx, -ny)
				if angle < 0 {
					angle += 2 * math.Pi
				}
				frac := angle / (2 * math.Pi)

				sliceIdx := 0
				for idx, cf := range cumFractions {
					if frac <= cf || idx == len(cumFractions)-1 {
						sliceIdx = idx
						break
					}
				}

				color := m.theme.Text
				if sliceIdx < len(sliceColors) {
					color = sliceColors[sliceIdx]
				}

				char := "█"
				if dist > float64(radius)-0.3 {
					char = "▓"
				}
				row.WriteString(lipgloss.NewStyle().Foreground(color).Render(char))
			} else {
				row.WriteString(" ")
			}
		}
		pieLines = append(pieLines, row.String())
	}

	// Build Legend lines
	var legendLines []string
	legendLines = append(legendLines, lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text).Render(legendHeading))
	for i, s := range stats {
		color := m.theme.Text
		if i < len(sliceColors) {
			color = sliceColors[i]
		}
		bullet := lipgloss.NewStyle().Foreground(color).Render("● ")
		label := i18n.Current.SeniorityLabel(s.Label)
		lbl := lipgloss.NewStyle().Foreground(m.theme.Text).Width(18).Render(label)
		cnt := lipgloss.NewStyle().Foreground(m.theme.Subtext).Render(fmt.Sprintf("%4d (%2.0f%%)", s.Count, s.Pct))
		legendLines = append(legendLines, bullet+lbl+cnt)
	}

	if showQualityBadge && m.metrics.QualityBarPct > 0 {
		summaryBadge := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Green).
			Render(fmt.Sprintf(i18n.Current.MeetQualityBar, m.metrics.QualityBarPct))
		legendLines = append(legendLines, "", summaryBadge)
	}

	// Combine Pie and Legend side by side
	pieBlock := strings.Join(pieLines, "\n")
	legendBlock := strings.Join(legendLines, "\n")

	chartWithLegend := lipgloss.JoinHorizontal(lipgloss.Center, pieBlock, "    ", legendBlock)

	return padStyle.Render(lipgloss.JoinVertical(lipgloss.Left, sectionTitle, "", chartWithLegend))
}

func (m StatsModel) renderArchetypeChart() string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	sectionTitle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Sky)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	var lines []string
	lines = append(lines, padStyle.Render(sectionTitle.Render(i18n.Current.ArchetypeTitle)))

	if len(m.metrics.Archetypes) == 0 {
		lines = append(lines, padStyle.Render(dimStyle.Render(i18n.Current.NoData)))
		return strings.Join(lines, "\n")
	}

	labelW := 26
	if m.width < 90 {
		labelW = 20
	}

	maxCount := 0
	for _, a := range m.metrics.Archetypes {
		if a.Count > maxCount {
			maxCount = a.Count
		}
	}

	barMaxW := 25
	if m.width < 90 {
		barMaxW = 15
	}

	for _, a := range m.metrics.Archetypes {
		label := a.Label
		if lipgloss.Width(label) > labelW-1 {
			runes := []rune(label)
			cut := labelW - 2
			if cut < 0 {
				cut = 0
			}
			if cut < len(runes) {
				label = string(runes[:cut]) + "…"
			}
		}

		barW := 0
		if maxCount > 0 {
			barW = a.Count * barMaxW / maxCount
		}
		if barW < 1 && a.Count > 0 {
			barW = 1
		}

		color := m.scoreColor(a.AvgScore)
		barStyle := lipgloss.NewStyle().Foreground(color)
		labelStyle := lipgloss.NewStyle().Foreground(m.theme.Text).Width(labelW)
		countStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(10)
		scoreStyle := lipgloss.NewStyle().Bold(true).Foreground(color).Width(10).Align(lipgloss.Right)

		bar := barStyle.Render(strings.Repeat("█", barW))
		lbl := labelStyle.Render(label)
		countStr := countStyle.Render(fmt.Sprintf("%4d (%.0f%%)", a.Count, a.Pct))

		scoreStr := "-"
		if a.AvgScore > 0 {
			scoreStr = fmt.Sprintf("★ %.1f/5", a.AvgScore)
		}
		score := scoreStyle.Render(scoreStr)

		lines = append(lines, padStyle.Render(lbl+countStr+" "+bar+" "+score))
	}

	return strings.Join(lines, "\n")
}

func (m StatsModel) renderLabelCountTable(title string, stats []model.LabelCountStat) string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	sectionTitle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Sky)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	var lines []string
	lines = append(lines, padStyle.Render(sectionTitle.Render(title)))

	if len(stats) == 0 {
		lines = append(lines, padStyle.Render(dimStyle.Render(i18n.Current.NoData)))
		return strings.Join(lines, "\n")
	}

	labelW := 18
	barMaxW := 25
	if m.width < 90 {
		barMaxW = 15
	}

	maxCount := 0
	for _, s := range stats {
		if s.Count > maxCount {
			maxCount = s.Count
		}
	}

	barColors := []lipgloss.Color{
		m.theme.Green,
		m.theme.Blue,
		m.theme.Yellow,
		m.theme.Peach,
		m.theme.Mauve,
		m.theme.Sky,
		m.theme.Red,
		m.theme.Text,
	}

	for i, s := range stats {
		barW := 0
		if maxCount > 0 {
			barW = s.Count * barMaxW / maxCount
		}
		if barW < 1 && s.Count > 0 {
			barW = 1
		}

		color := m.theme.Text
		if i < len(barColors) {
			color = barColors[i]
		}

		label := s.Label
		if lipgloss.Width(label) > labelW-1 {
			runes := []rune(label)
			cut := labelW - 2
			if cut < 0 {
				cut = 0
			}
			if cut < len(runes) {
				label = string(runes[:cut]) + "…"
			}
		}

		barStyle := lipgloss.NewStyle().Foreground(color)
		labelStyle := lipgloss.NewStyle().Foreground(m.theme.Text).Width(labelW)
		countStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

		bar := barStyle.Render(strings.Repeat("█", barW))
		lbl := labelStyle.Render(label)
		count := countStyle.Render(fmt.Sprintf("  %d (%.0f%%)", s.Count, s.Pct))

		lines = append(lines, padStyle.Render(lbl+bar+count))
	}

	return strings.Join(lines, "\n")
}

func (m StatsModel) renderPay() string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	sectionTitle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Sky)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	var lines []string
	lines = append(lines, padStyle.Render(sectionTitle.Render("💰 "+i18n.Current.PayTitle)))

	if m.metrics.Pay.Count == 0 {
		lines = append(lines, padStyle.Render(dimStyle.Render(i18n.Current.NoData)))
		return strings.Join(lines, "\n")
	}

	// 1. Summary KPIs
	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	valueStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Green)
	sepStyle := lipgloss.NewStyle().Foreground(m.theme.Overlay)
	sep := sepStyle.Render("  |  ")

	stats := labelStyle.Render(i18n.Current.PayAvg) +
		valueStyle.Render(formatMoney(m.metrics.Pay.AvgPayMax)) +
		sep +
		labelStyle.Render(i18n.Current.PayMedian) +
		valueStyle.Render(formatMoney(m.metrics.Pay.MedianPayMax)) +
		sep +
		labelStyle.Render(i18n.Current.PayMax) +
		valueStyle.Render(formatMoney(m.metrics.Pay.MaxPayMax))
	lines = append(lines, padStyle.Render(stats))

	info := dimStyle.Render(
		i18n.Current.PayCount + fmt.Sprintf("%d", m.metrics.Pay.Count) +
			"  (" + fmt.Sprintf(i18n.Current.PaySourceSplit, m.metrics.Pay.PostedCount, m.metrics.Pay.EstCount) + ")",
	)
	lines = append(lines, padStyle.Render(info))

	// 2. Salary Distribution Histogram
	if len(m.metrics.PayHistogram) > 0 {
		lines = append(lines, "")
		histTitle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Peach).Render(i18n.Current.SalaryBandDist)
		lines = append(lines, padStyle.Render(histTitle))

		maxHist := 0
		for _, b := range m.metrics.PayHistogram {
			if b.Count > maxHist {
				maxHist = b.Count
			}
		}

		barMaxW := 25
		if m.width < 90 {
			barMaxW = 15
		}

		for _, b := range m.metrics.PayHistogram {
			barW := 0
			if maxHist > 0 {
				barW = b.Count * barMaxW / maxHist
			}
			if barW < 1 && b.Count > 0 {
				barW = 1
			}

			barStyle := lipgloss.NewStyle().Foreground(m.theme.Green)
			labelStyle := lipgloss.NewStyle().Foreground(m.theme.Text).Width(16)
			countStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

			bar := barStyle.Render(strings.Repeat("█", barW))
			lbl := labelStyle.Render(b.Label)
			cnt := countStyle.Render(fmt.Sprintf("  %2d (%.0f%%)", b.Count, b.Pct))

			lines = append(lines, padStyle.Render(lbl+bar+cnt))
		}
	}

	return strings.Join(lines, "\n")
}

func formatMoney(v float64) string {
	if v >= 1000 {
		return fmt.Sprintf("$%.0fK", v/1000)
	}
	return fmt.Sprintf("$%.0f", v)
}

func (m StatsModel) renderHelp() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	brand := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render("career-ops by santifer.io")

	keys := keyStyle.Render("↑↓") + descStyle.Render(i18n.Current.HelpScroll) +
		keyStyle.Render("PgUp/Dn") + descStyle.Render(i18n.Current.HelpPage) +
		keyStyle.Render("t") + descStyle.Render(i18n.Current.HelpLanguage) +
		keyStyle.Render("Esc") + descStyle.Render(i18n.Current.HelpBack)

	gap := m.width - lipgloss.Width(keys) - lipgloss.Width(brand) - 2
	if gap < 1 {
		gap = 1
	}

	return style.Render(keys + strings.Repeat(" ", gap) + brand)
}

// scoreColor returns a color based on the fit score value, matching
// ProgressModel.rateColor's traffic-light convention adapted to a 0-5 scale.
func (m StatsModel) scoreColor(score float64) lipgloss.Color {
	switch {
	case score >= 4.0:
		return m.theme.Green
	case score >= 3.5:
		return m.theme.Sky
	case score >= 3.0:
		return m.theme.Yellow
	case score > 0:
		return m.theme.Peach
	default:
		return m.theme.Subtext
	}
}
