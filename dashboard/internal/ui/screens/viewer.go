package screens

import (
	"os"
	"regexp"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"
	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// ViewerClosedMsg is emitted when the viewer is dismissed.
type ViewerClosedMsg struct{}

// ViewerModel implements an integrated file viewer screen.
type ViewerModel struct {
	lines         []string
	renderedLines []string
	title         string
	scrollOffset  int
	width         int
	height        int
	theme         theme.Theme
}

// NewViewerModel creates a new file viewer for the given path.
func NewViewerModel(t theme.Theme, path, title string, width, height int) ViewerModel {
	content, err := os.ReadFile(path)
	if err != nil {
		content = []byte("Error reading file: " + err.Error())
	}

	var lines []string
	if len(content) > 0 {
		lines = strings.Split(string(content), "\n")
	}

	m := ViewerModel{
		lines:  lines,
		title:  title,
		width:  width,
		height: height,
		theme:  t,
	}
	m.rebuildRender()
	return m
}

// rebuildRender recomputes renderedLines from raw lines using the current width.
func (m *ViewerModel) rebuildRender() {
	m.renderedLines = m.renderAll()
	m.clampScrollOffset()
}

func (m *ViewerModel) clampScrollOffset() {
	maxScroll := len(m.renderedLines) - m.bodyHeight()
	if maxScroll < 0 {
		maxScroll = 0
	}
	if m.scrollOffset > maxScroll {
		m.scrollOffset = maxScroll
	}
	if m.scrollOffset < 0 {
		m.scrollOffset = 0
	}
}

func (m ViewerModel) Init() tea.Cmd {
	return nil
}

func (m *ViewerModel) Resize(width, height int) {
	m.width = width
	m.height = height
	m.rebuildRender()
}

func (m ViewerModel) Update(msg tea.Msg) (ViewerModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc":
			return m, func() tea.Msg { return ViewerClosedMsg{} }

		case "down", "j":
			maxScroll := len(m.renderedLines) - m.bodyHeight()
			if maxScroll < 0 {
				maxScroll = 0
			}
			if m.scrollOffset < maxScroll {
				m.scrollOffset++
			}

		case "up", "k":
			if m.scrollOffset > 0 {
				m.scrollOffset--
			}

		case "pgdown", "ctrl+d":
			jump := m.bodyHeight() / 2
			maxScroll := len(m.renderedLines) - m.bodyHeight()
			if maxScroll < 0 {
				maxScroll = 0
			}
			m.scrollOffset += jump
			if m.scrollOffset > maxScroll {
				m.scrollOffset = maxScroll
			}

		case "pgup", "ctrl+u":
			jump := m.bodyHeight() / 2
			m.scrollOffset -= jump
			if m.scrollOffset < 0 {
				m.scrollOffset = 0
			}

		case "home", "g":
			m.scrollOffset = 0

		case "end", "G":
			maxScroll := len(m.renderedLines) - m.bodyHeight()
			if maxScroll < 0 {
				maxScroll = 0
			}
			m.scrollOffset = maxScroll
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.rebuildRender()
	}

	return m, nil
}

func (m ViewerModel) bodyHeight() int {
	h := m.height - 4 // header + footer + padding
	if h < 3 {
		h = 3
	}
	return h
}

func (m ViewerModel) View() string {
	header := m.renderHeader()
	body := m.renderBody()
	footer := m.renderFooter()

	return lipgloss.JoinVertical(lipgloss.Left, header, body, footer)
}

func (m ViewerModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render(m.title)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	scroll := right.Render(func() string {
		if len(m.renderedLines) == 0 {
			return ""
		}
		pct := 0
		maxScroll := len(m.renderedLines) - m.bodyHeight()
		if maxScroll > 0 {
			pct = m.scrollOffset * 100 / maxScroll
		}
		if m.scrollOffset == 0 {
			return "Top"
		}
		if m.scrollOffset >= maxScroll {
			return "End"
		}
		return func() string {
			s := pct
			return string(rune('0'+s/10%10)) + string(rune('0'+s%10)) + "%"
		}()
	}())

	gap := m.width - lipgloss.Width(m.title) - lipgloss.Width(scroll) - 4
	if gap < 1 {
		gap = 1
	}

	return style.Render(title + strings.Repeat(" ", gap) + scroll)
}

func (m ViewerModel) renderBody() string {
	bh := m.bodyHeight()
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	if len(m.renderedLines) == 0 {
		emptyStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
		return padStyle.Render(emptyStyle.Render("(empty file)"))
	}

	end := m.scrollOffset + bh
	if end > len(m.renderedLines) {
		end = len(m.renderedLines)
	}
	visible := m.renderedLines[m.scrollOffset:end]

	flat := make([]string, bh)
	copy(flat, visible)

	return padStyle.Render(strings.Join(flat, "\n"))
}

// renderAll converts every raw markdown line into visual terminal lines.
func (m ViewerModel) renderAll() []string {
	var styled []string
	i := 0
	for i < len(m.lines) {
		line := m.lines[i]
		trimmed := strings.TrimSpace(line)

		if trimmed == "" {
			styled = append(styled, "")
			i++
			continue
		}

		if isTableLine(line) {
			tableStart := i
			for i < len(m.lines) && isTableLine(m.lines[i]) {
				i++
			}
			styled = append(styled, m.renderTableBlock(m.lines[tableStart:i])...)
			continue
		}

		if strings.HasPrefix(trimmed, "```") {
			i++
			var codeLines []string
			for i < len(m.lines) {
				if strings.TrimSpace(m.lines[i]) == "```" {
					i++
					break
				}
				codeLines = append(codeLines, m.lines[i])
				i++
			}
			codeStyle := lipgloss.NewStyle().Background(m.theme.Surface).Foreground(m.theme.Text)
			w := m.width - 6
			if w < 10 {
				w = 10
			}
			for _, cl := range codeLines {
				for _, wl := range strings.Split(ansi.Wrap("  "+cl, w, ""), "\n") {
					styled = append(styled, codeStyle.Render(wl))
				}
			}
			continue
		}

		if isSpecialBlockLine(trimmed) {
			styled = append(styled, m.styleLine(line))
			i++
			continue
		}

		start := i
		for i < len(m.lines) {
			next := strings.TrimSpace(m.lines[i])
			if next == "" || isSpecialBlockLine(next) {
				break
			}
			i++
		}
		if i > start {
			paraLines := m.lines[start:i]
			para := strings.Join(paraLines, " ")
			w := m.width - 6
			if w < 10 {
				w = 10
			}
			wrapped := m.wrapParagraph(m.renderInlineElements(para), w)
			for _, wl := range wrapped {
				styled = append(styled, wl)
			}
		}
	}

	var flat []string
	for _, s := range styled {
		if strings.IndexByte(s, '\n') >= 0 {
			flat = append(flat, strings.Split(s, "\n")...)
		} else {
			flat = append(flat, s)
		}
	}
	return flat
}

func isTableLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	return len(trimmed) > 1 && trimmed[0] == '|'
}

// isTableSeparator checks if a line is a table separator (|---|---|).
func isTableSeparator(line string) bool {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "|") {
		return false
	}
	cleaned := strings.NewReplacer("|", "", "-", "", ":", "", " ", "").Replace(trimmed)
	return cleaned == ""
}

// parseTableCells splits a table line into trimmed cells.
func parseTableCells(line string) []string {
	trimmed := strings.TrimSpace(line)
	// Remove leading and trailing pipes
	if len(trimmed) > 0 && trimmed[0] == '|' {
		trimmed = trimmed[1:]
	}
	if len(trimmed) > 0 && trimmed[len(trimmed)-1] == '|' {
		trimmed = trimmed[:len(trimmed)-1]
	}
	parts := strings.Split(trimmed, "|")
	cells := make([]string, len(parts))
	for i, p := range parts {
		cells[i] = strings.TrimSpace(p)
	}
	return cells
}

func detectAlignment(sep string) lipgloss.Position {
	s := strings.TrimSpace(sep)
	if strings.HasPrefix(s, ":") && strings.HasSuffix(s, ":") {
		return lipgloss.Center
	}
	if strings.HasSuffix(s, ":") {
		return lipgloss.Right
	}
	return lipgloss.Left
}

func (m ViewerModel) renderTableBlock(lines []string) []string {
	if len(lines) == 0 {
		return nil
	}

	var headers []string
	var dataRows [][]string
	var alignments []lipgloss.Position

	for _, line := range lines {
		if isTableSeparator(line) {
			if len(alignments) == 0 {
				for _, cell := range parseTableCells(line) {
					alignments = append(alignments, detectAlignment(cell))
				}
			}
			continue
		}
		cells := parseTableCells(line)
		rendered := make([]string, len(cells))
		for i, c := range cells {
			rendered[i] = m.renderInlineElements(c)
		}
		if headers == nil {
			headers = rendered
		} else {
			dataRows = append(dataRows, rendered)
		}
	}

	if len(headers) == 0 {
		var result []string
		for _, line := range lines {
			result = append(result, m.styleLine(line))
		}
		return result
	}

	w := m.width - 6
	if w < 10 {
		w = 10
	}

	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Overlay)
	t := table.New().
		Width(w).
		Wrap(true).
		BorderStyle(borderStyle).
		BorderTop(true).BorderBottom(true).
		BorderLeft(true).BorderRight(true).
		BorderHeader(true).BorderColumn(true)

	t.Headers(headers...)
	if len(dataRows) > 0 {
		t.Rows(dataRows...)
	}

	t.StyleFunc(func(row, col int) lipgloss.Style {
		st := lipgloss.NewStyle().Padding(0, 1)
		if row == table.HeaderRow {
			return st.Bold(true).Foreground(m.theme.Sky)
		}
		if col < len(alignments) {
			st = st.Align(alignments[col])
		}
		return st.Foreground(m.theme.Text)
	})

	return strings.Split(t.String(), "\n")
}

var (
	reBold       = regexp.MustCompile(`\*\*([^*]+)\*\*`)
	reLink       = regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)
	reBareURL    = regexp.MustCompile(`https?://\S*[^\s\)\]\.,;:!?]`)
	reInlineCode = regexp.MustCompile("`([^`]+)`")
	reListNumber = regexp.MustCompile(`^(\s*\d+\.\s+)(.*)$`)
)

func isHeadingLine(line string) bool {
	return strings.HasPrefix(line, "# ") ||
		strings.HasPrefix(line, "## ") ||
		strings.HasPrefix(line, "### ") ||
		strings.HasPrefix(line, "#### ") ||
		strings.HasPrefix(line, "##### ") ||
		strings.HasPrefix(line, "###### ")
}

func isSpecialBlockLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	return isHeadingLine(trimmed) ||
		trimmed == "---" || trimmed == "***" ||
		strings.HasPrefix(trimmed, "> ") ||
		strings.HasPrefix(trimmed, "|") ||
		strings.HasPrefix(trimmed, "```") ||
		strings.HasPrefix(trimmed, "- ") ||
		strings.HasPrefix(trimmed, "* ") ||
		reListNumber.MatchString(trimmed) ||
		(strings.HasPrefix(trimmed, "**") && strings.Contains(trimmed, ":**"))
}

func (m ViewerModel) wrapParagraph(text string, width int) []string {
	if width <= 0 {
		return []string{text}
	}
	wrapped := ansi.Wrap(text, width, "")
	return strings.Split(wrapped, "\n")
}

func (m ViewerModel) renderInlineElements(line string) string {
	return m.renderInlineElementsAs(line, m.theme.Subtext)
}

// renderInlineElementsAs walks the raw line once and reapplies baseColor around
// every plain-text span, so resets emitted by inline tokens (code, bold, link,
// bare URL) don't leak through to subsequent text.
func (m ViewerModel) renderInlineElementsAs(line string, baseColor lipgloss.Color) string {
	baseStyle := lipgloss.NewStyle().Foreground(baseColor)
	codeStyle := lipgloss.NewStyle().Background(m.theme.Surface).Foreground(m.theme.Text)
	boldStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Yellow)
	linkStyle := lipgloss.NewStyle().Foreground(m.theme.Blue)

	var b strings.Builder
	rest := line
	for rest != "" {
		match := findInlineMatch(rest, codeStyle, boldStyle, linkStyle)
		if match == nil {
			b.WriteString(baseStyle.Render(rest))
			break
		}
		if match.start > 0 {
			b.WriteString(baseStyle.Render(rest[:match.start]))
		}
		b.WriteString(match.rendered)
		rest = rest[match.end:]
	}
	return b.String()
}

type inlineMatch struct {
	start, end int
	rendered   string
}

func findInlineMatch(s string, codeStyle, boldStyle, linkStyle lipgloss.Style) *inlineMatch {
	var best *inlineMatch
	consider := func(loc []int, rendered func() string) {
		if loc == nil || (best != nil && loc[0] >= best.start) {
			return
		}
		best = &inlineMatch{start: loc[0], end: loc[1], rendered: rendered()}
	}

	if loc := reInlineCode.FindStringIndex(s); loc != nil {
		consider(loc, func() string { return codeStyle.Render(s[loc[0]+1 : loc[1]-1]) })
	}
	if loc := reBold.FindStringIndex(s); loc != nil {
		consider(loc, func() string { return boldStyle.Render(s[loc[0]+2 : loc[1]-2]) })
	}
	if loc := reLink.FindStringIndex(s); loc != nil {
		consider(loc, func() string {
			sm := reLink.FindStringSubmatch(s[loc[0]:loc[1]])
			if len(sm) >= 2 {
				return linkStyle.Render(sm[1])
			}
			return s[loc[0]:loc[1]]
		})
	}
	if loc := reBareURL.FindStringIndex(s); loc != nil {
		consider(loc, func() string { return linkStyle.Render(s[loc[0]:loc[1]]) })
	}
	return best
}

func (m ViewerModel) styleLine(line string) string {
	trimmed := strings.TrimSpace(line)
	w := m.width - 6
	if w < 10 {
		w = 10
	}

	if strings.HasPrefix(trimmed, "# ") && !strings.HasPrefix(trimmed, "## ") {
		content := strings.TrimPrefix(trimmed, "# ")
		return lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Width(w).Render("  " + content)
	}
	if strings.HasPrefix(trimmed, "## ") && !strings.HasPrefix(trimmed, "### ") {
		content := strings.TrimPrefix(trimmed, "## ")
		return lipgloss.NewStyle().Bold(true).Foreground(m.theme.Mauve).Width(w).Render("  " + content)
	}
	if strings.HasPrefix(trimmed, "### ") && !strings.HasPrefix(trimmed, "#### ") {
		content := strings.TrimPrefix(trimmed, "### ")
		return lipgloss.NewStyle().Bold(true).Foreground(m.theme.Sky).Width(w).Render("  " + content)
	}
	if strings.HasPrefix(trimmed, "#### ") && !strings.HasPrefix(trimmed, "##### ") {
		content := strings.TrimPrefix(trimmed, "#### ")
		return lipgloss.NewStyle().Bold(true).Foreground(m.theme.Subtext).Width(w).Render("    " + content)
	}
	if strings.HasPrefix(trimmed, "##### ") && !strings.HasPrefix(trimmed, "###### ") {
		content := strings.TrimPrefix(trimmed, "##### ")
		return lipgloss.NewStyle().Bold(true).Foreground(m.theme.Overlay).Width(w).Render("      " + content)
	}
	if strings.HasPrefix(trimmed, "###### ") {
		content := strings.TrimPrefix(trimmed, "###### ")
		return lipgloss.NewStyle().Bold(true).Foreground(m.theme.Overlay).Width(w).Render("        " + content)
	}
	if trimmed == "---" || trimmed == "***" {
		return lipgloss.NewStyle().Foreground(m.theme.Overlay).Width(w).Render(strings.Repeat("─", w))
	}
	if strings.HasPrefix(trimmed, "> ") {
		content := strings.TrimPrefix(trimmed, "> ")
		border := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render("▎ ")
		textStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Italic(true)
		wrapped := strings.Split(ansi.Wrap(textStyle.Render(content), w-2, ""), "\n")
		result := make([]string, 0, len(wrapped))
		for i, line := range wrapped {
			if i == 0 {
				result = append(result, border+line)
			} else {
				result = append(result, strings.Repeat(" ", ansi.StringWidth(border))+line)
			}
		}
		return strings.Join(result, "\n")
	}
	if strings.HasPrefix(trimmed, "**") && strings.Contains(trimmed, ":**") {
		styled := m.renderInlineElements(line)
		return ansi.Wrap(styled, w, "")
	}
	if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") {
		content := trimmed[2:]
		marker := lipgloss.NewStyle().Foreground(m.theme.Blue).Render("• ")
		return m.renderListItem(marker, content, w)
	}
	if reListNumber.MatchString(trimmed) {
		sm := reListNumber.FindStringSubmatch(trimmed)
		if len(sm) >= 3 {
			marker := lipgloss.NewStyle().Foreground(m.theme.Blue).Render(sm[1])
			return m.renderListItem(marker, sm[2], w)
		}
	}

	styled := m.renderInlineElementsAs(trimmed, m.theme.Subtext)
	return ansi.Wrap(styled, w, "")
}

func (m ViewerModel) renderListItem(marker, content string, width int) string {
	markerWidth := ansi.StringWidth(marker)
	textWidth := width - markerWidth
	if textWidth < 10 {
		textWidth = 10
	}
	styled := m.renderInlineElementsAs(content, m.theme.Text)
	lines := strings.Split(ansi.Wrap(styled, textWidth, ""), "\n")
	result := make([]string, 0, len(lines))
	for i, line := range lines {
		if i == 0 {
			result = append(result, marker+line)
		} else {
			result = append(result, strings.Repeat(" ", markerWidth)+line)
		}
	}
	return strings.Join(result, "\n")
}

func (m ViewerModel) renderFooter() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	return style.Render(
		keyStyle.Render("↑↓") + descStyle.Render(" scroll  ") +
			keyStyle.Render("PgUp/Dn") + descStyle.Render(" page  ") +
			keyStyle.Render("g/G") + descStyle.Render(" top/end  ") +
			keyStyle.Render("Esc") + descStyle.Render(" back"))
}
