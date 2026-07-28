package screens

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"
	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// ViewerClosedMsg is emitted when the viewer is dismissed.
type ViewerClosedMsg struct{}

// ViewerOpenCoverLetterMsg is emitted when the user requests to open the cover letter PDF.
type ViewerOpenCoverLetterMsg struct{ Path string }

// ViewerUpdateStatusMsg is emitted when a status update is requested from the viewer.
type ViewerUpdateStatusMsg struct {
	App       model.CareerApplication
	NewStatus string
}

// ViewerModel implements an integrated file viewer screen.
type ViewerModel struct {
	lines           []string
	renderedLines   []string
	title           string
	scrollOffset    int
	width           int
	height          int
	theme           theme.Theme
	app             model.CareerApplication
	careerOpsPath   string
	coverLetterPath string
	statusPicker    bool
	statusCursor    int
}

// NewViewerModel creates a new file viewer for the given path.
func NewViewerModel(t theme.Theme, careerOpsPath, path, title string, width, height int, app model.CareerApplication) ViewerModel {
	content, err := os.ReadFile(path)
	if err != nil {
		content = []byte("Error reading file: " + err.Error())
	}

	var lines []string
	if len(content) > 0 {
		lines = strings.Split(string(content), "\n")
	}

	m := ViewerModel{
		lines:           lines,
		title:           title,
		width:           width,
		height:          height,
		theme:           t,
		app:             app,
		careerOpsPath:   careerOpsPath,
		coverLetterPath: parseCoverLetterPath(lines, careerOpsPath),
	}
	m.rebuildRender()
	return m
}

// parseCoverLetterPath scans the report lines for a "PDF generated: output/..." line
// inside a "## Cover Letter Draft" section and returns the relative path if the file exists.
func parseCoverLetterPath(lines []string, careerOpsPath string) string {
	inCoverSection := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## Cover Letter Draft") {
			inCoverSection = true
			continue
		}
		if inCoverSection && strings.HasPrefix(trimmed, "## ") {
			break
		}
		if inCoverSection {
			if m := reCoverLetterPDF.FindStringSubmatch(line); m != nil {
				relPath := m[1]
				abs := filepath.Join(careerOpsPath, filepath.FromSlash(relPath))
				if _, err := os.Stat(abs); err == nil {
					return relPath
				}
			}
		}
	}
	return ""
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
		if m.statusPicker {
			return m.handleStatusPicker(msg)
		}
		switch msg.String() {
		case "q", "esc":
			return m, func() tea.Msg { return ViewerClosedMsg{} }

		case "c":
			m.statusPicker = true
			m.statusCursor = 0
			currentNorm := data.NormalizeStatus(m.app.Status)
			for idx, pair := range getStatusPairs() {
				if pair.Canonical == currentNorm {
					m.statusCursor = idx
					break
				}
			}
			m.clampScrollOffset()
			return m, nil

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

		case "L":
			if m.coverLetterPath != "" {
				fullPath := filepath.Join(m.careerOpsPath, filepath.FromSlash(m.coverLetterPath))
				return m, func() tea.Msg { return ViewerOpenCoverLetterMsg{Path: fullPath} }
			}
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
	if m.statusPicker {
		h -= (len(getStatusPairs()) + 1)
	}
	if h < 3 {
		h = 3
	}
	return h
}

func (m ViewerModel) View() string {
	header := m.renderHeader()
	body := m.renderBody()
	if m.statusPicker {
		body = m.overlayStatusPicker(body)
	}
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
	reBold           = regexp.MustCompile(`\*\*([^*]+)\*\*`)
	reLink           = regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)
	reBareURL        = regexp.MustCompile(`https?://\S*[^\s\)\]\.,;:!?]`)
	reInlineCode     = regexp.MustCompile("`([^`]+)`")
	reListNumber     = regexp.MustCompile(`^(\s*\d+\.\s+)(.*)$`)
	reCoverLetterPDF = regexp.MustCompile(`PDF generated:\s*(output/[^\s]+\.pdf)`)
	reRelPDFPath     = regexp.MustCompile(`output/cv-[^\s\)\]\.,;:!?"']+\.pdf`)
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
		match := findInlineMatch(rest, codeStyle, boldStyle, linkStyle, m.careerOpsPath)
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

func findInlineMatch(s string, codeStyle, boldStyle, linkStyle lipgloss.Style, careerOpsPath string) *inlineMatch {
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
	if loc := reRelPDFPath.FindStringIndex(s); loc != nil {
		consider(loc, func() string {
			relPath := s[loc[0]:loc[1]]
			styled := linkStyle.Render(relPath)
			if careerOpsPath == "" {
				return styled
			}
			joined := filepath.Join(careerOpsPath, filepath.FromSlash(relPath))
			absPath, err := filepath.Abs(joined)
			if err != nil {
				return styled
			}
			forward := filepath.ToSlash(absPath)
			if !strings.HasPrefix(forward, "/") {
				forward = "/" + forward // Windows: C:/... → /C:/...
			}
			// OSC 8 hyperlink: ESC ] 8 ; ; URL BEL text ESC ] 8 ; ; BEL
			return "\x1b]8;;" + "file://" + forward + "\x07" + styled + "\x1b]8;;\x07"
		})
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

	if m.statusPicker {
		return style.Render(
			keyStyle.Render("↑/↓/j/k") + descStyle.Render(i18n.Current.HelpNav) +
				keyStyle.Render("Enter") + descStyle.Render(i18n.Current.HelpConfirm) +
				keyStyle.Render("Esc/q") + descStyle.Render(i18n.Current.HelpCancel))
	}

	// Render standard footer shortcuts
	footer := keyStyle.Render("↑↓") + descStyle.Render(i18n.Current.HelpScroll) + // nav
		keyStyle.Render("PgUp/Dn") + descStyle.Render(i18n.Current.HelpPage) + // pagination
		keyStyle.Render("g/G") + descStyle.Render(i18n.Current.HelpTopEnd) + // top/bottom
		keyStyle.Render("c") + descStyle.Render(i18n.Current.HelpChange) + // status
		keyStyle.Render("t") + descStyle.Render(i18n.Current.HelpLanguage) + // language
		keyStyle.Render("Esc") + descStyle.Render(i18n.Current.HelpBack) // exit

	if m.coverLetterPath != "" {
		footer += "  " + keyStyle.Render("L") + descStyle.Render(" cover letter")
	}

	return style.Render(footer)
}

func (m ViewerModel) handleStatusPicker(msg tea.KeyMsg) (ViewerModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.statusPicker = false
		m.clampScrollOffset()
		return m, nil

	case "down", "j":
		m.statusCursor++
		if m.statusCursor >= len(getStatusPairs()) {
			m.statusCursor = len(getStatusPairs()) - 1
		}

	case "up", "k":
		m.statusCursor--
		if m.statusCursor < 0 {
			m.statusCursor = 0
		}

	case "enter":
		m.statusPicker = false
		m.clampScrollOffset()
		newStatus := getStatusPairs()[m.statusCursor].Canonical
		return m, func() tea.Msg {
			return ViewerUpdateStatusMsg{
				App:       m.app,
				NewStatus: newStatus,
			}
		}
	}
	return m, nil
}

func (m ViewerModel) overlayStatusPicker(body string) string {
	bodyLines := strings.Split(body, "\n")

	pickerWidth := 30
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Blue).
		Bold(true)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render(i18n.Current.PickerChangeStatus)))

	for i, pair := range getStatusPairs() {
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.statusCursor {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		prefix := "  "
		if i == m.statusCursor {
			prefix = " >"
		}
		picker = append(picker, padStyle.Render(prefix+style.Render(pair.Display)))
	}

	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

// UpdateAppStatus updates the status of the current application inside the viewer model.
func (m *ViewerModel) UpdateAppStatus(newStatus string) {
	m.app.Status = newStatus
}
