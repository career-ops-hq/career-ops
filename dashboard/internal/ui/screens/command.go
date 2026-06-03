package screens

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// CommandClosedMsg is emitted when the command center should quit the app.
type CommandClosedMsg struct{}

// CommandOpenPipelineMsg is emitted when the pipeline table should open.
type CommandOpenPipelineMsg struct{}

// CommandOpenProgressMsg is emitted when progress analytics should open.
type CommandOpenProgressMsg struct{}

// CommandRefreshMsg requests a full dashboard reload from disk.
type CommandRefreshMsg struct{}

// CommandModel renders the default job-search command center.
type CommandModel struct {
	ctx           model.DashboardContext
	width, height int
	theme         theme.Theme
}

// NewCommandModel creates the command center screen.
func NewCommandModel(t theme.Theme, ctx model.DashboardContext, width, height int) CommandModel {
	return CommandModel{theme: t, ctx: ctx, width: width, height: height}
}

func (m CommandModel) Init() tea.Cmd { return nil }

// Resize updates dimensions.
func (m *CommandModel) Resize(width, height int) {
	m.width = width
	m.height = height
}

// WithContext refreshes command-center data while preserving screen dimensions.
func (m CommandModel) WithContext(ctx model.DashboardContext) CommandModel {
	m.ctx = ctx
	return m
}

// Update handles command-center navigation.
func (m CommandModel) Update(msg tea.Msg) (CommandModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, func() tea.Msg { return CommandClosedMsg{} }
		case "p":
			return m, func() tea.Msg { return CommandOpenPipelineMsg{} }
		case "a":
			return m, func() tea.Msg { return CommandOpenProgressMsg{} }
		case "r":
			return m, func() tea.Msg { return CommandRefreshMsg{} }
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

// View renders the command center.
func (m CommandModel) View() string {
	parts := []string{
		m.renderHeader(),
		m.renderNextAction(),
		m.renderMetrics(),
		m.renderJourney(),
		m.renderReadiness(),
		m.renderHelp(),
	}

	view := lipgloss.JoinVertical(lipgloss.Left, parts...)
	lines := strings.Split(view, "\n")
	if m.height > 0 && len(lines) > m.height {
		lines = lines[:m.height]
	}
	return strings.Join(lines, "\n")
}

func (m CommandModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render("CAREER COMMAND CENTER")
	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	setup := right.Render(fmt.Sprintf("setup %d/%d | %d reports", m.ctx.RequiredReady, m.ctx.RequiredTotal, m.ctx.ReportCount))
	gap := m.width - lipgloss.Width(title) - lipgloss.Width(setup) - 4
	if gap < 1 {
		gap = 1
	}
	return style.Render(title + strings.Repeat(" ", gap) + setup)
}

func (m CommandModel) renderNextAction() string {
	pad := lipgloss.NewStyle().Padding(1, 2, 0, 2)
	label := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Yellow).Render("NEXT BEST ACTION")
	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text).Render(m.ctx.NextAction.Title)
	detail := lipgloss.NewStyle().Foreground(m.theme.Subtext).Render(m.ctx.NextAction.Detail)
	command := lipgloss.NewStyle().Foreground(m.theme.Green).Render(m.ctx.NextAction.Command)
	return pad.Render(lipgloss.JoinVertical(lipgloss.Left, label, title, detail, "Run: "+command))
}

func (m CommandModel) renderMetrics() string {
	pad := lipgloss.NewStyle().Padding(1, 2, 0, 2)
	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	valueStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)

	cards := []string{
		metricPair(labelStyle, valueStyle, "evaluated", fmt.Sprintf("%d", m.ctx.Metrics.Total)),
		metricPair(labelStyle, valueStyle, "active", fmt.Sprintf("%d", m.ctx.Metrics.Actionable)),
		metricPair(labelStyle, valueStyle, "avg score", fmt.Sprintf("%.1f", m.ctx.Metrics.AvgScore)),
		metricPair(labelStyle, valueStyle, "top score", fmt.Sprintf("%.1f", m.ctx.Metrics.TopScore)),
		metricPair(labelStyle, valueStyle, "pending URLs", fmt.Sprintf("%d", m.ctx.PendingURLs)),
		metricPair(labelStyle, valueStyle, "PDFs", fmt.Sprintf("%d", m.ctx.Metrics.WithPDF)),
	}
	return pad.Render(strings.Join(cards, "  "))
}

func metricPair(labelStyle, valueStyle lipgloss.Style, label, value string) string {
	return labelStyle.Render(label+":") + " " + valueStyle.Render(value)
}

func (m CommandModel) renderJourney() string {
	pad := lipgloss.NewStyle().Padding(1, 2, 0, 2)
	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Sky).Render("Journey rail")
	var lines []string
	lines = append(lines, title)
	for _, step := range m.ctx.Journey {
		status := m.statusBadge(step.Status)
		name := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text).Render(step.Label)
		detail := lipgloss.NewStyle().Foreground(m.theme.Subtext).Render(step.Detail)
		lines = append(lines, fmt.Sprintf("%s %-12s %s", status, name, detail))
	}
	return pad.Render(strings.Join(lines, "\n"))
}

func (m CommandModel) renderReadiness() string {
	pad := lipgloss.NewStyle().Padding(1, 2, 0, 2)
	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Sky).Render("Readiness")
	var lines []string
	lines = append(lines, title)
	for _, item := range m.ctx.Readiness {
		marker := "[ ]"
		color := m.theme.Yellow
		if item.Ready {
			marker = "[x]"
			color = m.theme.Green
		} else if item.Required {
			color = m.theme.Red
		}
		required := "optional"
		if item.Required {
			required = "required"
		}
		markerStyled := lipgloss.NewStyle().Foreground(color).Render(marker)
		label := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text).Render(item.Label)
		path := lipgloss.NewStyle().Foreground(m.theme.Subtext).Render(item.Path)
		lines = append(lines, fmt.Sprintf("%s %-14s %-26s %s", markerStyled, label, path, required))
	}
	return pad.Render(strings.Join(lines, "\n"))
}

func (m CommandModel) renderHelp() string {
	style := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(m.width).Padding(1, 2, 0, 2)
	return style.Render("p pipeline  a analytics  r refresh  q quit")
}

func (m CommandModel) statusBadge(status string) string {
	label := strings.ToUpper(status)
	color := m.theme.Subtext
	switch status {
	case "done":
		color = m.theme.Green
	case "active":
		color = m.theme.Yellow
	case "todo":
		color = m.theme.Subtext
	}
	return lipgloss.NewStyle().Foreground(color).Render("[" + label + "]")
}
