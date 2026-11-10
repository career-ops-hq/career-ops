package screens

// The Inbox tab (#5269): the Pending rows of data/pipeline.md, beside the
// tracker tabs, with the first-pass rank and what the batch files record for
// each row. It is read only. No key on this tab writes a file, and none skips,
// queues, triages or evaluates a row.
//
// Two things keep it that way. applyFilterAndSort leaves the tracker's row
// list empty while the Inbox is active, so CurrentApp has nothing to return
// and every tracker action has no row to act on. And handleKey sends every
// key to handlePendingKey first, which lets through only the keys listed in
// pendingSharedKeys and swallows the rest.

import (
	"fmt"
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
)

const filterPending = "pending"

// pendingSortCycle is what `s` steps through on the Inbox. The tracker's own
// sort mode is kept apart, so sorting one never reorders the other.
var pendingSortCycle = []string{sortScore, sortPosted, sortCompany, sortLocation}

// pendingSharedKeys act on the Inbox exactly as they do on a tracker tab, and
// none of them touches a row: the key list, clearing a search, quitting,
// opening search, moving between tabs, the manifesto, the progress and stats
// screens, and refresh. The language toggle (`t`) is handled in main.go before
// any screen sees the key.
var pendingSharedKeys = map[string]bool{
	"?": true, "esc": true, "q": true, "/": true,
	"f": true, "right": true, "l": true, "left": true, "h": true,
	"m": true, "p": true, "S": true, "r": true,
}

// PipelinePendingFailedMsg reports that data/pipeline.md or a batch file could
// not be read. The Inbox keeps the rows it had.
type PipelinePendingFailedMsg struct {
	Err string
}

func (m PipelineModel) onPendingTab() bool {
	tabs := getPipelineTabs()
	return m.activeTab >= 0 && m.activeTab < len(tabs) && tabs[m.activeTab].filter == filterPending
}

// SetPendingRows replaces the Inbox rows. The selection stays on the same URL
// when that row is still listed.
func (m *PipelineModel) SetPendingRows(rows []data.PendingRow) {
	selected := ""
	if row, ok := m.currentPendingRow(); ok {
		selected = row.URL
	}
	m.pending = rows
	m.pendingErr = ""
	m.applyFilterAndSort()
	m.restorePendingCursor(selected)
}

// leavePendingTab moves to ALL when the Inbox is active. Flows that write the
// tracker (the discard reason picker, the hired flow) call it, so they never
// run on the read-only tab.
func (m *PipelineModel) leavePendingTab() {
	if !m.onPendingTab() {
		return
	}
	m.activeTab = defaultTabIndex()
	m.applyFilterAndSort()
	m.cursor = 0
	m.scrollOffset = 0
}

// restorePendingCursor puts the cursor back on url, or keeps it in range.
func (m *PipelineModel) restorePendingCursor(url string) {
	if !m.onPendingTab() {
		return
	}
	if url != "" {
		for i, row := range m.pendingView {
			if row.URL == url {
				m.cursor = i
				m.adjustScroll()
				return
			}
		}
	}
	if m.cursor >= len(m.pendingView) {
		m.cursor = len(m.pendingView) - 1
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
	m.adjustScroll()
}

func (m PipelineModel) currentPendingRow() (data.PendingRow, bool) {
	if !m.onPendingTab() || m.cursor < 0 || m.cursor >= len(m.pendingView) {
		return data.PendingRow{}, false
	}
	return m.pendingView[m.cursor], true
}

// shownCount is how many rows the active tab lists after search.
func (m PipelineModel) shownCount() int {
	if m.onPendingTab() {
		return len(m.pendingView)
	}
	return len(m.filtered)
}

func (m PipelineModel) pendingSortMode() string {
	for _, mode := range pendingSortCycle {
		if mode == m.pendingSort {
			return mode
		}
	}
	return sortScore
}

// applyPendingFilterAndSort builds the Inbox list. The tracker list is left
// empty on purpose (see the top of this file).
func (m *PipelineModel) applyPendingFilterAndSort() {
	view := make([]data.PendingRow, 0, len(m.pending))
	for _, row := range m.pending {
		if matchesPendingSearch(row, m.searchQuery) {
			view = append(view, row)
		}
	}
	less := pendingLess(m.pendingSortMode())
	sort.SliceStable(view, func(i, j int) bool { return less(view[i], view[j]) })
	m.pendingView = view
	m.filtered = nil
}

func matchesPendingSearch(row data.PendingRow, query string) bool {
	if query == "" {
		return true
	}
	q := strings.ToLower(query)
	for _, field := range []string{row.Company, row.Role, row.Location, row.URL} {
		if strings.Contains(strings.ToLower(field), q) {
			return true
		}
	}
	return false
}

// pendingLess orders the Inbox. The default is the first-pass rank, highest
// first, unranked rows after every ranked one; ties keep file order, because
// the sort is stable.
func pendingLess(mode string) func(a, b data.PendingRow) bool {
	switch mode {
	case sortPosted:
		return func(a, b data.PendingRow) bool {
			if (a.Posted == "") != (b.Posted == "") {
				return a.Posted != ""
			}
			return a.Posted > b.Posted
		}
	case sortCompany:
		return func(a, b data.PendingRow) bool {
			return strings.ToLower(a.Company) < strings.ToLower(b.Company)
		}
	case sortLocation:
		return func(a, b data.PendingRow) bool {
			if (a.Location == "") != (b.Location == "") {
				return a.Location != ""
			}
			return strings.ToLower(a.Location) < strings.ToLower(b.Location)
		}
	default:
		return func(a, b data.PendingRow) bool {
			if a.HasRank != b.HasRank {
				return a.HasRank
			}
			return a.Rank > b.Rank
		}
	}
}

// handlePendingKey runs a key on the Inbox. handled is false only for a key in
// pendingSharedKeys, which handleKey then runs as it does on any tab. Every
// other key is consumed here, and does nothing unless it is listed below.
func (m PipelineModel) handlePendingKey(msg tea.KeyMsg) (next PipelineModel, cmd tea.Cmd, handled bool) {
	key := msg.String()
	if pendingSharedKeys[key] {
		return m, nil, false
	}
	n := len(m.pendingView)
	halfPage := max(1, m.height/2)
	switch key {
	case "down", "j":
		if n > 0 {
			m.cursor = min(m.cursor+1, n-1)
			m.adjustScroll()
		}
	case "up", "k":
		if n > 0 {
			m.cursor = max(m.cursor-1, 0)
			m.adjustScroll()
		}
	case "g":
		m.cursor = 0
		m.scrollOffset = 0
	case "G":
		if n > 0 {
			m.cursor = n - 1
			m.adjustScroll()
		}
	case "pgdown", "ctrl+d":
		if n > 0 {
			m.cursor = min(m.cursor+halfPage, n-1)
			m.adjustScroll()
		}
	case "pgup", "ctrl+u":
		if n > 0 {
			m.cursor = max(m.cursor-halfPage, 0)
			m.adjustScroll()
		}
	case "s":
		mode := m.pendingSortMode()
		for i, s := range pendingSortCycle {
			if s == mode {
				m.pendingSort = pendingSortCycle[(i+1)%len(pendingSortCycle)]
				break
			}
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
	case "o":
		row, ok := m.currentPendingRow()
		if !ok {
			break
		}
		// isWebURL (viewer.go): an absolute http(s) URL with a host, so a
		// `local:` row or a `javascript:` target never reaches the opener.
		if !isWebURL(row.URL) {
			m.flash = fmt.Sprintf(i18n.Current.InboxNoWebURL, row.URL)
			break
		}
		target := row.URL
		return m, func() tea.Msg { return PipelineOpenURLMsg{URL: target} }, true
	}
	return m, nil, true
}

func pendingStatusLabel(status string) string {
	switch status {
	case data.PendingStatusQueued:
		return i18n.Current.InboxStatusQueued
	case data.PendingStatusRunning:
		return i18n.Current.InboxStatusRunning
	case data.PendingStatusPaused:
		return i18n.Current.InboxStatusPaused
	case data.PendingStatusNeedsAnswer:
		return i18n.Current.InboxStatusNeedsAnswer
	case data.PendingStatusFailed:
		return i18n.Current.InboxStatusFailed
	case data.PendingStatusDone:
		return i18n.Current.InboxStatusDone
	default:
		return ""
	}
}

func (m PipelineModel) pendingStatusColor(status string) lipgloss.Color {
	switch status {
	case data.PendingStatusRunning:
		return m.theme.Blue
	case data.PendingStatusPaused:
		return m.theme.Yellow
	case data.PendingStatusNeedsAnswer:
		return m.theme.Peach
	case data.PendingStatusFailed:
		return m.theme.Red
	case data.PendingStatusDone:
		return m.theme.Green
	default:
		return m.theme.Sky
	}
}

var pendingStatuses = []string{
	data.PendingStatusQueued, data.PendingStatusRunning, data.PendingStatusPaused,
	data.PendingStatusNeedsAnswer, data.PendingStatusFailed, data.PendingStatusDone,
}

func pendingRankText(row data.PendingRow) string {
	if row.HasRank {
		return fmt.Sprintf("%.1f/5", row.Rank)
	}
	return i18n.Current.InboxNotRanked
}

// pendingColWidths holds per-column cell budgets for the Inbox table. A zero
// location or posted width means that column is hidden.
type pendingColWidths struct {
	rank, company, role, loc, posted, status int
}

func (m PipelineModel) pendingColumnWidths() pendingColWidths {
	rank := max(5, lipgloss.Width(i18n.Current.ColRank), lipgloss.Width(i18n.Current.InboxNotRanked))
	status := lipgloss.Width(i18n.Current.ColStatus)
	for _, s := range pendingStatuses {
		status = max(status, lipgloss.Width(pendingStatusLabel(s)))
	}
	c := pendingColWidths{rank: rank, company: 16, loc: 16, posted: 10, status: status}
	roleFloor := 15
	for {
		segments := 4 // rank, company, role, status
		if c.loc > 0 {
			segments++
		}
		if c.posted > 0 {
			segments++
		}
		// One space between segments, one before the first, and Padding(0, 2).
		overhead := (segments - 1) + 1 + 4
		c.role = m.width - overhead - c.rank - c.company - c.loc - c.posted - c.status
		if m.width <= 0 || c.role >= roleFloor {
			break
		}
		switch {
		case c.posted > 0:
			c.posted = 0
		case c.loc > 0:
			c.loc = 0
		case c.company > 8:
			c.company--
		case roleFloor > 6:
			roleFloor--
		default:
			c.role = max(c.role, 1)
			return c
		}
	}
	c.role = max(c.role, 1)
	return c
}

func (m PipelineModel) renderPendingColumnHeader() string {
	cw := m.pendingColumnWidths()
	h := lipgloss.NewStyle().Foreground(m.theme.Subtext).Bold(true)
	cell := func(label string, width int) string {
		return h.Width(width).Render(truncateCells(label, width))
	}
	segments := []string{
		cell(i18n.Current.ColRank, cw.rank),
		cell(i18n.Current.ColCompany, cw.company),
		cell(i18n.Current.ColRole, cw.role),
	}
	if cw.loc > 0 {
		segments = append(segments, cell(i18n.Current.ColLocation, cw.loc))
	}
	if cw.posted > 0 {
		segments = append(segments, cell(i18n.Current.ColPosted, cw.posted))
	}
	segments = append(segments, cell(i18n.Current.ColStatus, cw.status))
	padStyle := lipgloss.NewStyle().Padding(0, 2).MaxWidth(max(1, m.width)).MaxHeight(1)
	return padStyle.Render(" " + strings.Join(segments, " "))
}

func (m PipelineModel) renderPendingLine(row data.PendingRow, selected bool) string {
	cw := m.pendingColumnWidths()
	rankStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	if row.HasRank {
		rankStyle = m.scoreStyle(row.Rank)
	}
	segments := []string{
		rankStyle.Width(cw.rank).Render(truncateCells(pendingRankText(row), cw.rank)),
		lipgloss.NewStyle().Foreground(m.theme.Text).Width(cw.company).Render(truncateCells(row.Company, cw.company)),
		lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(cw.role).Render(truncateCells(row.Role, cw.role)),
	}
	if cw.loc > 0 {
		loc := row.Location
		if loc == "" {
			loc = "—"
		}
		segments = append(segments, lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(cw.loc).Render(truncateCells(loc, cw.loc)))
	}
	if cw.posted > 0 {
		segments = append(segments, m.renderPostedCell(model.CareerApplication{PostedOn: row.Posted}, cw.posted))
	}
	segments = append(segments, lipgloss.NewStyle().Foreground(m.pendingStatusColor(row.Status)).Width(cw.status).
		Render(truncateCells(pendingStatusLabel(row.Status), cw.status)))

	line := " " + strings.Join(segments, " ")
	padStyle := lipgloss.NewStyle().Padding(0, 2).MaxWidth(max(1, m.width)).MaxHeight(1)
	if selected {
		selStyle := lipgloss.NewStyle().Background(m.theme.Overlay).Width(max(1, m.width-4)).MaxHeight(1)
		return padStyle.Render(selStyle.Render(line))
	}
	return padStyle.Render(line)
}

// renderPendingBodyWindow returns at most height Inbox rows starting at start,
// one display line per row.
func (m PipelineModel) renderPendingBodyWindow(start, height int) []string {
	if len(m.pendingView) == 0 {
		msg := i18n.Current.InboxEmpty
		color := m.theme.Subtext
		switch {
		case len(m.pending) > 0:
			msg = i18n.Current.NoOffersMatch
		case m.pendingErr != "":
			// Unreadable is not empty: say so instead of "no pending rows".
			msg = sanitizeFlash(fmt.Sprintf(i18n.Current.InboxUnavailable, m.pendingErr))
			color = m.theme.Peach
		}
		empty := lipgloss.NewStyle().Foreground(color).Padding(1, 2).Width(max(1, m.width)).Render(msg)
		lines := strings.Split(empty, "\n")
		return lines[:min(len(lines), max(height, 0))]
	}
	if start < 0 || start >= len(m.pendingView) {
		start = 0
	}
	end := min(len(m.pendingView), start+max(height, 0))
	lines := make([]string, 0, end-start)
	for i := start; i < end; i++ {
		lines = append(lines, m.renderPendingLine(m.pendingView[i], i == m.cursor))
	}
	return lines
}

// renderPendingPreview shows the selected row's rank reason and URL.
func (m PipelineModel) renderPendingPreview() string {
	row, ok := m.currentPendingRow()
	if !ok {
		return ""
	}
	padStyle := lipgloss.NewStyle().Padding(0, 2).MaxWidth(max(1, m.width)).MaxHeight(1)
	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Sky).Bold(true)
	valueStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	budget := func(label string) int { return max(0, m.width-4-lipgloss.Width(label)) }

	rank := pendingRankText(row)
	if row.HasRank && row.RankReason != "" {
		rank += " — " + row.RankReason
	}
	lines := []string{
		padStyle.Render(lipgloss.NewStyle().Foreground(m.theme.Overlay).Render(strings.Repeat("─", max(0, m.width-4)))),
		padStyle.Render(labelStyle.Render(i18n.Current.LabelRank) + valueStyle.Render(fitPlain(budget(i18n.Current.LabelRank), rank))),
		padStyle.Render(labelStyle.Render(i18n.Current.LabelURL) + valueStyle.Render(fitPlain(budget(i18n.Current.LabelURL), row.URL))),
	}
	return strings.Join(lines, "\n")
}

// renderPendingSummary takes the place of the tracker's status counts.
func (m PipelineModel) renderPendingSummary() string {
	style := lipgloss.NewStyle().Background(m.theme.Surface).Padding(0, 2)
	unranked := 0
	counts := map[string]int{}
	for _, row := range m.pending {
		if !row.HasRank {
			unranked++
		}
		counts[row.Status]++
	}
	parts := []string{lipgloss.NewStyle().Foreground(m.theme.Text).
		Render(fmt.Sprintf(i18n.Current.InboxSummary, len(m.pending), unranked))}
	if m.pendingErr != "" {
		// The rows shown are from the last good read, or there are none.
		parts = []string{lipgloss.NewStyle().Foreground(m.theme.Peach).
			Render(sanitizeFlash(fmt.Sprintf(i18n.Current.InboxUnavailable, m.pendingErr)))}
	}
	for _, s := range pendingStatuses {
		if counts[s] > 0 {
			parts = append(parts, lipgloss.NewStyle().Foreground(m.pendingStatusColor(s)).
				Render(fmt.Sprintf("%s:%d", pendingStatusLabel(s), counts[s])))
		}
	}
	return oneLine(m.width, style, strings.Join(parts, "  "))
}

func (m PipelineModel) renderPendingSortBar() string {
	style := lipgloss.NewStyle().Foreground(m.theme.Subtext).Padding(0, 2)
	mode := m.pendingSortMode()
	label := i18n.Current.SortModeLabel(mode)
	if mode == sortScore {
		label = i18n.Current.SortRank
	}
	sortLabel := fmt.Sprintf(i18n.Current.SortLabel, label)
	count := fmt.Sprintf(i18n.Current.ShownCount, len(m.pendingView))
	return oneLine(m.width, style, sortLabel+"  "+count)
}

// pendingHelpItems are the keys the Inbox footer and `?` list offer: the
// allowlist, and nothing that would act on a tracker row.
func pendingHelpItems() []keyHelpItem {
	return []keyHelpItem{
		{"↑↓/jk", i18n.Current.HelpNav},
		{"←→/hl", i18n.Current.HelpTabs},
		{"/", i18n.Current.HelpSearch},
		{"s", i18n.Current.HelpSort},
		{"r", i18n.Current.HelpRefresh},
		{"o", i18n.Current.HelpOpenURL},
		{"p", i18n.Current.HelpProgress},
		{"S", i18n.Current.HelpStats},
		{"t", i18n.Current.HelpLanguage},
		{"m", i18n.Current.HelpManifesto},
		{"g/G", i18n.Current.HelpTopEnd},
		{"?", i18n.Current.HelpKeys},
		{"q", i18n.Current.HelpQuit},
	}
}
