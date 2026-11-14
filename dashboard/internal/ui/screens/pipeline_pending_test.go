package screens

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// The Inbox tab (#5269): pending rows of data/pipeline.md beside the tracker
// tabs, read only.

func inboxTrackerApps() []model.CareerApplication {
	return []model.CareerApplication{
		{Number: 1, Company: "Globex", Role: "Engineer", Status: "Evaluated", Score: 4.1, HasScore: true, ReportPath: "reports/001-globex.md", JobURL: "https://jobs.example.com/globex"},
		{Number: 2, Company: "Initech", Role: "Analyst", Status: "Applied", Score: 3.6, HasScore: true},
	}
}

func inboxRows() []data.PendingRow {
	return []data.PendingRow{
		{URL: "https://jobs.example.com/low", Company: "Acme", Role: "Low", Location: "Remote", Rank: 2.1, HasRank: true, RankReason: "weak fit"},
		{URL: "local:jds/acme-unranked.md", Company: "Acme", Role: "Unranked"},
		{URL: "https://jobs.example.com/high", Company: "Acme", Role: "High", Location: "Berlin", Posted: "2026-10-01", Rank: 4.5, HasRank: true, RankReason: "strong fit", Status: data.PendingStatusQueued},
	}
}

func newInboxModel(t *testing.T, rows []data.PendingRow) PipelineModel {
	t.Helper()
	apps := inboxTrackerApps()
	m := NewPipelineModel(theme.NewTheme(""), apps, data.ComputeMetrics(apps), t.TempDir(), 140, 40)
	m.SetPendingRows(rows)
	return m
}

func onInbox(t *testing.T, m PipelineModel) PipelineModel {
	t.Helper()
	m.activeTab = tabIndexForFilter(t, filterPending)
	m.applyFilterAndSort()
	m.cursor = 0
	return m
}

func press(m PipelineModel, keys ...string) (PipelineModel, []tea.Cmd) {
	var cmds []tea.Cmd
	for _, k := range keys {
		var msg tea.KeyMsg
		switch k {
		case "enter":
			msg = tea.KeyMsg{Type: tea.KeyEnter}
		case "esc":
			msg = tea.KeyMsg{Type: tea.KeyEsc}
		case "left":
			msg = tea.KeyMsg{Type: tea.KeyLeft}
		case "right":
			msg = tea.KeyMsg{Type: tea.KeyRight}
		case "down":
			msg = tea.KeyMsg{Type: tea.KeyDown}
		case "pgdown":
			msg = tea.KeyMsg{Type: tea.KeyPgDown}
		case "pgup":
			msg = tea.KeyMsg{Type: tea.KeyPgUp}
		default:
			msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
		}
		var cmd tea.Cmd
		m, cmd = m.Update(msg)
		cmds = append(cmds, cmd)
	}
	return m, cmds
}

func TestInboxTabSitsLeftOfAllAndAllStaysTheDefault(t *testing.T) {
	m := newInboxModel(t, inboxRows())
	tabs := getPipelineTabs()
	if tabs[0].filter != filterPending || tabs[1].filter != filterAll {
		t.Fatalf("tabs start %q, %q; want pending then all", tabs[0].filter, tabs[1].filter)
	}
	if tabs[m.activeTab].filter != filterAll {
		t.Fatalf("dashboard opened on %q, want all", tabs[m.activeTab].filter)
	}
	if m.onPendingTab() || len(m.filtered) != 2 {
		t.Fatalf("ALL tab shows %d tracker rows, want 2", len(m.filtered))
	}
	m, _ = press(m, "left")
	if !m.onPendingTab() {
		t.Fatalf("← from ALL landed on %q, want the Inbox", getPipelineTabs()[m.activeTab].filter)
	}
	if got := ansi.Strip(m.renderTabs()); !strings.Contains(got, "INBOX (3)") {
		t.Fatalf("tabs = %q, want INBOX (3)", got)
	}
}

func TestInboxStaysActiveAcrossAReload(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m, _ = press(m, "j") // select the 4.5 → 2.1 row
	selected, _ := m.currentPendingRow()

	apps := inboxTrackerApps()
	reloaded := m.WithReloadedData(apps, data.ComputeMetrics(apps))
	if !reloaded.onPendingTab() {
		t.Fatal("reload left the Inbox")
	}
	if row, ok := reloaded.currentPendingRow(); !ok || row.URL != selected.URL {
		t.Fatalf("reload moved the selection to %#v, want %s", row, selected.URL)
	}
	fresh := append(inboxRows(), data.PendingRow{URL: "https://jobs.example.com/new", Company: "Umbrella", Role: "New"})
	reloaded.SetPendingRows(fresh)
	if !reloaded.onPendingTab() || len(reloaded.pendingView) != 4 {
		t.Fatalf("after reload the Inbox lists %d rows, want 4", len(reloaded.pendingView))
	}
	if row, _ := reloaded.currentPendingRow(); row.URL != selected.URL {
		t.Fatalf("new rows moved the selection to %s, want %s", row.URL, selected.URL)
	}
}

func TestInboxReloadFailureKeepsPreviousRows(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m, _ = m.Update(PipelinePendingFailedMsg{Err: "read data/pipeline.md: permission denied"})
	if len(m.pendingView) != 3 {
		t.Fatalf("a failed read dropped the Inbox rows: %d left", len(m.pendingView))
	}
	if help := ansi.Strip(m.renderHelp()); !strings.Contains(help, "permission denied") {
		t.Fatalf("flash = %q, want the read error", help)
	}
}

func TestInboxTabStaysVisibleOnANarrowTerminal(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m.width = 30
	tabs := ansi.Strip(m.renderTabs())
	if !strings.Contains(tabs, "INBOX (3)") || !strings.Contains(tabs, "›") {
		t.Fatalf("narrow tabs = %q, want the active INBOX tab and a › marker", tabs)
	}
	m, _ = press(m, "right", "right", "right")
	tabs = ansi.Strip(m.renderTabs())
	if !strings.Contains(tabs, "INTERVIEW (0)") || !strings.Contains(tabs, "‹") {
		t.Fatalf("narrow tabs two past ALL = %q, want the active INTERVIEW tab and a ‹ marker", tabs)
	}
}

func TestInboxWithNoRowsShowsZeroAndAnEmptyMessage(t *testing.T) {
	m := onInbox(t, newInboxModel(t, nil))
	if got := ansi.Strip(m.renderTabs()); !strings.Contains(got, "INBOX (0)") {
		t.Fatalf("tabs = %q, want INBOX (0)", got)
	}
	view := ansi.Strip(m.View())
	if !strings.Contains(view, i18n.Current.InboxEmpty) {
		t.Fatalf("empty Inbox view lacks %q:\n%s", i18n.Current.InboxEmpty, view)
	}
	m, cmds := press(m, "j", "k", "G", "g", "o", "s", "pgdown", "pgup")
	for _, cmd := range cmds {
		if cmd != nil {
			t.Fatalf("a key on the empty Inbox returned a command")
		}
	}
	_ = m.View()
}

func TestInboxOrdersByRankThenUnranked(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	var roles []string
	for _, row := range m.pendingView {
		roles = append(roles, row.Role)
	}
	if want := []string{"High", "Low", "Unranked"}; !reflect.DeepEqual(roles, want) {
		t.Fatalf("order = %v, want %v", roles, want)
	}
	body := ansi.Strip(strings.Join(m.renderBodyWindow(0, 10), "\n"))
	if !strings.Contains(body, "4.5") || !strings.Contains(body, "2.1") || strings.Contains(body, "/5") {
		t.Fatalf("body lacks the ranks, or shows them with /5:\n%s", body)
	}
	if strings.Index(body, "High") > strings.Index(body, "Low") || strings.Index(body, "Low") > strings.Index(body, "Unranked") {
		t.Fatalf("rendered order is wrong:\n%s", body)
	}
}

func TestInboxUnrankedRowShowsADashAndThePreviewSaysNotRanked(t *testing.T) {
	m := onInbox(t, newInboxModel(t, []data.PendingRow{{URL: "https://jobs.example.com/u", Company: "Acme", Role: "Unranked"}}))
	line := ansi.Strip(m.renderPendingLine(m.pendingView[0], false))
	if !strings.HasPrefix(strings.TrimSpace(line), "—") || strings.Contains(line, "/5") {
		t.Fatalf("unranked row = %q, want the tracker's em dash first and no /5", line)
	}
	if preview := ansi.Strip(m.renderPreview()); !strings.Contains(preview, i18n.Current.InboxNotRanked) || strings.Contains(preview, "/5") {
		t.Fatalf("preview = %q", preview)
	}
}

// The Inbox columns follow the tracker's order (score, company, role, status,
// location, posted), so switching tabs does not reshuffle the table.
func TestInboxColumnsFollowTheTrackerOrder(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	header := ansi.Strip(m.renderColumnHeader())
	labels := []string{i18n.Current.ColRank, i18n.Current.ColCompany, i18n.Current.ColRole,
		i18n.Current.ColStatus, i18n.Current.ColLocation, i18n.Current.ColPosted}
	last := -1
	for _, label := range labels {
		at := strings.Index(header, label)
		if at <= last {
			t.Fatalf("header %q: %q is out of order, want %v", header, label, labels)
		}
		last = at
	}
	line := ansi.Strip(m.renderPendingLine(m.pendingView[0], false))
	status, loc := strings.Index(line, i18n.Current.InboxStatusQueued), strings.Index(line, "Berlin")
	if status < 0 || loc < 0 || status > loc {
		t.Fatalf("row %q: want the status, then the location", line)
	}
	if !strings.HasPrefix(strings.TrimSpace(line), "4.5 ") {
		t.Fatalf("row %q: want the rank as the tracker shows a score, 4.5 with no /5", line)
	}
}

// The Inbox uses the tracker's location width, drops posted and then location
// as the tracker does when the terminal narrows, and keeps every row within it.
func TestInboxColumnWidthsAndNarrowing(t *testing.T) {
	for _, tc := range []struct {
		width            int
		wantLoc, wantPos bool
	}{{140, true, true}, {80, true, false}, {40, false, false}} {
		m := onInbox(t, newInboxModel(t, inboxRows()))
		m.width = tc.width
		cw := m.pendingColumnWidths()
		if (cw.loc > 0) != tc.wantLoc || (cw.posted > 0) != tc.wantPos {
			t.Errorf("width %d: loc=%d posted=%d, want loc shown %v, posted shown %v", tc.width, cw.loc, cw.posted, tc.wantLoc, tc.wantPos)
		}
		if cw.loc > 0 && cw.loc != 20 {
			t.Errorf("width %d: loc = %d, want the tracker's 20", tc.width, cw.loc)
		}
		if cw.posted > 0 && cw.loc == 0 {
			t.Errorf("width %d: posted shown without location; posted must drop first", tc.width)
		}
		for i, row := range m.pendingView {
			if w := lipgloss.Width(m.renderPendingLine(row, i == 0)); w > tc.width {
				t.Errorf("width %d: row %d is %d cells wide", tc.width, i, w)
			}
		}
		if w := lipgloss.Width(m.renderColumnHeader()); w > tc.width {
			t.Errorf("width %d: header is %d cells wide", tc.width, w)
		}
	}
}

func TestInboxShowsRankReasonAndURLInThePreview(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	preview := ansi.Strip(m.renderPreview())
	for _, want := range []string{"4.5/5 — strong fit", "https://jobs.example.com/high"} {
		if !strings.Contains(preview, want) {
			t.Fatalf("preview lacks %q:\n%s", want, preview)
		}
	}
}

func TestInboxShowsBatchStatus(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	if line := ansi.Strip(m.renderPendingLine(m.pendingView[0], false)); !strings.Contains(line, i18n.Current.InboxStatusQueued) {
		t.Fatalf("queued row = %q", line)
	}
	if line := ansi.Strip(m.renderPendingLine(m.pendingView[1], false)); strings.Contains(line, i18n.Current.InboxStatusQueued) {
		t.Fatalf("row with no batch entry shows a status: %q", line)
	}
}

func TestInboxReachesEveryRowByScrolling(t *testing.T) {
	var rows []data.PendingRow
	for i := 1; i <= 30; i++ {
		rows = append(rows, data.PendingRow{URL: fmt.Sprintf("https://jobs.example.com/%d", i), Company: fmt.Sprintf("Company%02d", i), Role: "Role"})
	}
	m := onInbox(t, newInboxModel(t, rows))
	m.height = 20
	seen := map[string]bool{}
	for i := 0; i < 30; i++ {
		for _, c := range []string{"Company01", "Company15", "Company30"} {
			if strings.Contains(ansi.Strip(m.View()), c) {
				seen[c] = true
			}
		}
		m, _ = press(m, "j")
	}
	if m.cursor != 29 || len(seen) != 3 {
		t.Fatalf("cursor = %d, seen %v; want 29 and all three companies on screen at some point", m.cursor, seen)
	}
	m, _ = press(m, "g")
	if m.cursor != 0 {
		t.Fatalf("g left the cursor at %d", m.cursor)
	}
	m, _ = press(m, "G")
	if m.cursor != 29 {
		t.Fatalf("G left the cursor at %d", m.cursor)
	}
}

func TestInboxRendersNoEscapeFromFileText(t *testing.T) {
	rows := data.ParsePendingRows("## Pending\n- [ ] https://jobs.example.com/x\x1b[2J | Ac\x1b[2Jme\x1b]8;;https://evil.example\x07 | Ro\x9ble | Re\x1b[31mmote | rank: 4/5 — re\x1b[1Jason\n")
	m := onInbox(t, newInboxModel(t, rows))
	view := m.View()
	for _, bad := range []string{"\x1b[2J", "\x1b[1J", "\x1b]8;;https://evil", "\x07", "\x9b", "\x1b[31mmote"} {
		if strings.Contains(view, bad) {
			t.Fatalf("view carries %q from the file", bad)
		}
	}
	// Only the control bytes go, as in tracker cells: the printable rest stays.
	if !strings.Contains(ansi.Strip(view), "Ac[2Jme") {
		t.Fatalf("sanitizing dropped the text around the escape:\n%s", ansi.Strip(view))
	}
}

func TestInboxTrackerKeysDoNothing(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m, _ = press(m, "j")
	before := m
	// `e` queues the row and has its own tests (pipeline_pending_queue_test.go).
	for _, k := range []string{"c", "d", "y", "D", "v", "C", "enter", "x", "u", "T", "i", "n", " "} {
		after, cmds := press(m, k)
		if cmds[0] != nil {
			t.Errorf("%q returned a command on the Inbox", k)
		}
		if after.statusPicker || after.colPicker || after.pdfPicker || after.discardPicker || after.hiredStep != 0 {
			t.Errorf("%q opened a picker on the Inbox", k)
		}
		if after.viewMode != before.viewMode || after.cursor != before.cursor || after.flash != "" || !after.onPendingTab() {
			t.Errorf("%q changed the Inbox: view %q→%q cursor %d→%d flash %q", k, before.viewMode, after.viewMode, before.cursor, after.cursor, after.flash)
		}
	}
	if _, ok := m.CurrentApp(); ok {
		t.Fatal("the Inbox exposed a tracker row to tracker actions")
	}
}

func TestInboxOpenKey(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	_, cmds := press(m, "o")
	if cmds[0] == nil {
		t.Fatal("o on an http(s) row returned no command")
	}
	if msg, ok := cmds[0]().(PipelineOpenURLMsg); !ok || msg.URL != "https://jobs.example.com/high" {
		t.Fatalf("o sent %#v, want PipelineOpenURLMsg for the high row", msg)
	}

	for _, target := range []string{"local:jds/acme-unranked.md", "javascript:alert(1)", "https://", "file:///etc/passwd"} {
		m := onInbox(t, newInboxModel(t, []data.PendingRow{{URL: target, Company: "Acme", Role: "Odd"}}))
		after, cmds := press(m, "o")
		if cmds[0] != nil {
			t.Errorf("o on %q returned a command", target)
		}
		if !strings.Contains(after.flash, target) {
			t.Errorf("o on %q flashed %q, want it to name the target", target, after.flash)
		}
	}
}

func TestInboxFooterAndKeyListOfferOnlyInboxKeys(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m.width = 400
	footer := ansi.Strip(m.renderHelp())
	m.keysHelp = true
	list := ansi.Strip(m.renderKeysHelp(100))
	for _, k := range []string{"c", "d", "y", "D", "v", "C", "Enter"} {
		for name, text := range map[string]string{"footer": footer, "? list": list} {
			if helpOffersKey(text, k) {
				t.Errorf("Inbox %s offers %q:\n%s", name, k, text)
			}
		}
	}
	for _, k := range []string{"o", "/", "s", "r", "?", "q"} {
		if !helpOffersKey(list, k) {
			t.Errorf("Inbox ? list lacks %q:\n%s", k, list)
		}
	}
	if m.keyHelpRowCount() != (len(pendingHelpItems())+1)/2 {
		t.Errorf("keyHelpRowCount = %d for %d Inbox bindings", m.keyHelpRowCount(), len(pendingHelpItems()))
	}
}

// helpOffersKey reports whether a help text lists key as a binding: the key
// standing alone, followed by its description.
func helpOffersKey(text, key string) bool {
	for _, field := range strings.Fields(text) {
		if field == key {
			return true
		}
	}
	return false
}

func TestTrackerTabsKeepTheirKeys(t *testing.T) {
	m := newInboxModel(t, inboxRows())
	m.width = 400
	footer := ansi.Strip(m.renderHelp())
	for _, k := range []string{"c", "d", "y", "D", "v", "C", "Enter"} {
		if !helpOffersKey(footer, k) {
			t.Errorf("tracker footer lost %q:\n%s", k, footer)
		}
	}
	if m.keyHelpRowCount() != 10 {
		t.Errorf("tracker keyHelpRowCount = %d, want 10", m.keyHelpRowCount())
	}

	after, _ := press(m, "c")
	if !after.statusPicker {
		t.Error("c on a tracker tab did not open the status picker")
	}
	after, _ = press(m, "C")
	if !after.colPicker {
		t.Error("C on a tracker tab did not open the column picker")
	}
	after, _ = press(m, "v")
	if after.viewMode == m.viewMode {
		t.Error("v on a tracker tab did not switch the view")
	}
	for i, app := range m.filtered {
		if app.ReportPath != "" {
			m.cursor = i
		}
	}
	_, cmds := press(m, "enter")
	if cmds[0] == nil {
		t.Fatal("Enter on a tracker row with a report returned no command")
	}
	if _, ok := cmds[0]().(PipelineOpenReportMsg); !ok {
		t.Error("Enter on a tracker tab did not open the report")
	}
	_, cmds = press(m, "o")
	if msg, ok := cmds[0]().(PipelineOpenURLMsg); !ok || msg.URL != "https://jobs.example.com/globex" {
		t.Errorf("o on a tracker tab sent %#v", msg)
	}
}

func TestInboxSearchAndSortStayOnTheInbox(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m, _ = press(m, "/", "b", "e", "r", "l", "enter")
	if len(m.pendingView) != 1 || m.pendingView[0].Role != "High" {
		t.Fatalf("search berl = %#v", m.pendingView)
	}
	if bar := ansi.Strip(m.renderSearchBar()); !strings.Contains(bar, "1/3") {
		t.Fatalf("search bar = %q, want 1/3", bar)
	}
	m, _ = press(m, "esc")
	if len(m.pendingView) != 3 {
		t.Fatalf("esc left %d rows", len(m.pendingView))
	}
	trackerSort := m.sortMode
	m, _ = press(m, "s")
	if m.pendingSortMode() != sortPosted || m.pendingView[0].Role != "High" {
		t.Fatalf("s → %q, first %q; want posted, High", m.pendingSortMode(), m.pendingView[0].Role)
	}
	if m.sortMode != trackerSort {
		t.Fatal("sorting the Inbox changed the tracker's sort")
	}
	if bar := ansi.Strip(m.renderSortBar()); !strings.Contains(bar, i18n.Current.SortPosted) {
		t.Fatalf("sort bar = %q", bar)
	}
	m, _ = press(m, "s", "s", "s")
	if m.pendingSortMode() != sortScore {
		t.Fatalf("sort did not cycle back to rank: %q", m.pendingSortMode())
	}
}

func TestInboxLabelsInEveryLanguage(t *testing.T) {
	defer i18n.SetLang("en")
	for _, lang := range []string{"en", "tr", "es"} {
		i18n.SetLang(lang)
		m := onInbox(t, newInboxModel(t, inboxRows()))
		view := ansi.Strip(m.View())
		for _, want := range []string{i18n.Current.TabInbox, i18n.Current.ColRank, i18n.Current.InboxNotRanked, i18n.Current.InboxStatusQueued} {
			if want == "" || !strings.Contains(view, want) {
				t.Errorf("%s view lacks %q", lang, want)
			}
		}
	}
}

func TestInboxKeepsShowingAFailedRead(t *testing.T) {
	// At startup there are no earlier rows. The error must stay on the tab
	// after the flash is gone, not turn into "no pending rows".
	m := onInbox(t, newInboxModel(t, nil))
	m, _ = m.Update(PipelinePendingFailedMsg{Err: "read data/pipeline.md: permission denied"})
	m, _ = press(m, "j") // any key clears the flash
	view := ansi.Strip(m.View())
	if strings.Contains(view, i18n.Current.InboxEmpty) {
		t.Fatalf("an unreadable inbox reads as empty:\n%s", view)
	}
	if !strings.Contains(view, "permission denied") {
		t.Fatalf("the read error left the Inbox after one key:\n%s", view)
	}

	// With earlier rows the rows stay, and the summary says they are stale.
	m = onInbox(t, newInboxModel(t, inboxRows()))
	m, _ = m.Update(PipelinePendingFailedMsg{Err: "permission denied"})
	m, _ = press(m, "j")
	if s := ansi.Strip(m.renderMetrics()); !strings.Contains(s, "permission denied") || len(m.pendingView) != 3 {
		t.Fatalf("summary = %q with %d rows", s, len(m.pendingView))
	}
	apps := inboxTrackerApps()
	m = m.WithReloadedData(apps, data.ComputeMetrics(apps))
	if m.pendingErr == "" {
		t.Fatal("a tracker reload dropped the Inbox read error")
	}
	m.SetPendingRows(inboxRows())
	if m.pendingErr != "" || strings.Contains(ansi.Strip(m.renderMetrics()), "permission denied") {
		t.Fatal("a successful read kept the old error")
	}
}

func TestTrackerWriteFlowsNeverRunOnTheInbox(t *testing.T) {
	// A status change started on a tracker tab can finish after the user has
	// moved to the Inbox. Its picker or hired flow must not run there.
	m := onInbox(t, newInboxModel(t, inboxRows()))
	app := inboxTrackerApps()[0]
	m, _ = m.Update(pipelineStartDiscardPickerMsg{app: app, newStatus: "Discarded"})
	if m.onPendingTab() || !m.discardPicker {
		t.Fatalf("discard picker: on Inbox = %v, picker open = %v; want ALL with the picker", m.onPendingTab(), m.discardPicker)
	}

	m = onInbox(t, newInboxModel(t, inboxRows()))
	m, _ = m.StartHiredFlow(app)
	if m.onPendingTab() || m.hiredStep != 1 {
		t.Fatalf("hired flow: on Inbox = %v, step %d; want ALL and step 1", m.onPendingTab(), m.hiredStep)
	}
}

func TestKeyListRowCountFollowsTheList(t *testing.T) {
	// The count was a fixed 19 for 20 tracker bindings, so on a narrow
	// terminal the last binding could not be scrolled to.
	m := newInboxModel(t, inboxRows())
	m.width = 40
	if got := m.keyHelpRowCount(); got != 20 {
		t.Fatalf("narrow tracker key list = %d rows, want 20", got)
	}
	m = onInbox(t, m)
	if got := m.keyHelpRowCount(); got != len(pendingHelpItems()) {
		t.Fatalf("narrow Inbox key list = %d rows, want %d", got, len(pendingHelpItems()))
	}
}
