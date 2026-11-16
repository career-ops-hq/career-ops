package screens

import (
	"fmt"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
)

// `x` on the Inbox skips the selected row and `u` puts back the last row
// skipped in this session (#5269). The screen only asks; main.go runs
// inbox-skip.mjs and reports back (inbox_skip_test.go drives that launch).

// skipRequest runs the command a key returned and checks it asks for a skip.
func skipRequest(t *testing.T, cmd tea.Cmd) PipelineSkipMsg {
	t.Helper()
	if cmd == nil {
		t.Fatal("the key returned no command")
	}
	msg, ok := cmd().(PipelineSkipMsg)
	if !ok {
		t.Fatalf("the key sent %#v, want PipelineSkipMsg", cmd())
	}
	return msg
}

// skipped is an Inbox on which `x` skipped the low row, as main.go reports it:
// the row has left the Inbox and the script exited 0.
func skipped(t *testing.T) PipelineModel {
	t.Helper()
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m, _ = press(m, "j") // rank order: High, Low, Unranked; select Low
	rows := []data.PendingRow{inboxRows()[1], inboxRows()[2]}
	m.SetPendingRows(rows)
	m, _ = m.Update(PipelineSkipDoneMsg{URL: "https://jobs.example.com/low"})
	return m
}

func TestInboxXSkipsTheSelectedRow(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m, _ = press(m, "j")
	after, cmds := press(m, "x")
	msg := skipRequest(t, cmds[0])
	if msg.URL != "https://jobs.example.com/low" || msg.Undo || msg.CareerOpsPath != m.careerOpsPath {
		t.Fatalf("x asked for %+v, want a skip of the selected row under %s", msg, m.careerOpsPath)
	}
	if !after.onPendingTab() || after.cursor != m.cursor {
		t.Fatal("x moved off the selected Inbox row")
	}
	if !strings.Contains(after.flash, "https://jobs.example.com/low") {
		t.Fatalf("flash = %q, want it to name the row being skipped", after.flash)
	}
	if after.pendingLastSkip != "" {
		t.Fatal("x armed undo before the script reported the skip")
	}
}

func TestInboxXRefusesARowThatIsNotAWebAddress(t *testing.T) {
	for _, target := range []string{"local:jds/acme-unranked.md", "javascript:alert(1)", "https://"} {
		m := onInbox(t, newInboxModel(t, []data.PendingRow{{URL: target, Company: "Acme", Role: "Odd"}}))
		after, cmds := press(m, "x")
		if cmds[0] != nil {
			t.Errorf("x on %q returned a command", target)
		}
		if !strings.Contains(after.flash, target) {
			t.Errorf("x on %q flashed %q, want it to name the target", target, after.flash)
		}
	}
}

func TestInboxXOnAnEmptyInboxDoesNothing(t *testing.T) {
	m := onInbox(t, newInboxModel(t, nil))
	after, cmds := press(m, "x")
	if cmds[0] != nil || after.flash != "" {
		t.Fatalf("x on the empty Inbox: command %v, flash %q", cmds[0] != nil, after.flash)
	}
}

func TestInboxUWithNothingSkippedSaysSo(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	after, cmds := press(m, "u")
	if cmds[0] != nil {
		t.Fatal("u with nothing skipped returned a command")
	}
	if after.flash != i18n.Current.InboxUndoNothing {
		t.Fatalf("flash = %q, want InboxUndoNothing", after.flash)
	}
}

func TestInboxUPutsBackTheLastSkipWhicheverRowIsSelected(t *testing.T) {
	m := skipped(t)
	if !strings.Contains(m.flash, "https://jobs.example.com/low") || !strings.Contains(m.flash, "u ") {
		t.Fatalf("skip flash = %q, want the URL and the u hint", m.flash)
	}
	m, _ = press(m, "G") // select another row; u still means the skipped one
	after, cmds := press(m, "u")
	msg := skipRequest(t, cmds[0])
	if msg.URL != "https://jobs.example.com/low" || !msg.Undo {
		t.Fatalf("u asked for %+v, want an undo of the skipped row", msg)
	}
	if !strings.Contains(after.flash, "https://jobs.example.com/low") {
		t.Fatalf("flash = %q, want the row being put back", after.flash)
	}

	// The row is back after main.go's reload; the cursor lands on it.
	after.SetPendingRows(inboxRows())
	after, _ = after.Update(PipelineSkipDoneMsg{URL: "https://jobs.example.com/low", Undo: true})
	if row, ok := after.currentPendingRow(); !ok || row.URL != "https://jobs.example.com/low" {
		t.Fatalf("after the undo the cursor is on %#v, want the restored row", row)
	}
	if after.flash != fmt.Sprintf(i18n.Current.InboxUndone, "https://jobs.example.com/low") {
		t.Fatalf("flash = %q, want InboxUndone", after.flash)
	}

	// One undo per skip: there is no history behind it.
	again, cmds := press(after, "u")
	if cmds[0] != nil || again.flash != i18n.Current.InboxUndoNothing {
		t.Fatalf("a second u: command %v, flash %q", cmds[0] != nil, again.flash)
	}
}

func TestInboxOnlyASkipThisSessionMadeCanBeUndone(t *testing.T) {
	for name, done := range map[string]PipelineSkipDoneMsg{
		"no-op":      {URL: "https://jobs.example.com/low", Unchanged: true},
		"unreadable": {URL: "https://jobs.example.com/low", Unreadable: true},
		"failure":    {URL: "https://jobs.example.com/low", Err: "boom"},
	} {
		m := onInbox(t, newInboxModel(t, inboxRows()))
		m, _ = m.Update(done)
		if m.pendingLastSkip != "" {
			t.Errorf("a %s skip armed undo", name)
		}
	}
}

func TestInboxUndoOutcomes(t *testing.T) {
	// A failed undo keeps the skip, so u tries again.
	m := skipped(t)
	m, _ = m.Update(PipelineSkipDoneMsg{URL: "https://jobs.example.com/low", Undo: true, Err: "pipeline.md is being written by another command right now. Try again."})
	if m.pendingLastSkip != "https://jobs.example.com/low" || !strings.Contains(m.flash, "being written by another command") {
		t.Fatalf("after a failed undo: armed %q, flash %q", m.pendingLastSkip, m.flash)
	}
	if _, cmds := press(m, "u"); cmds[0] == nil {
		t.Fatal("u after a failed undo did not try again")
	}

	// Nothing to undo any more, or the row has left Pending: say so, and stop offering it.
	for name, done := range map[string]PipelineSkipDoneMsg{
		"unchanged": {URL: "https://jobs.example.com/low", Undo: true, Unchanged: true},
		"gone":      {URL: "https://jobs.example.com/low", Undo: true, Unreadable: true},
	} {
		m := skipped(t)
		m, _ = m.Update(done)
		if m.pendingLastSkip != "" {
			t.Errorf("%s undo left undo armed", name)
		}
		if !strings.Contains(m.flash, "https://jobs.example.com/low") {
			t.Errorf("%s undo flashed %q, want the URL", name, m.flash)
		}
	}
}

func TestInboxSkipOutcomesInEveryLanguage(t *testing.T) {
	defer i18n.SetLang("en")
	for _, lang := range []string{"en", "tr", "es"} {
		i18n.SetLang(lang)
		m := onInbox(t, newInboxModel(t, inboxRows()))
		m, _ = m.Update(PipelineSkipDoneMsg{URL: "https://jobs.example.com/low", Unchanged: true})
		if m.flash != fmt.Sprintf(i18n.Current.InboxSkipUnchanged, "https://jobs.example.com/low") {
			t.Errorf("%s no-op flash = %q", lang, m.flash)
		}
		m, _ = m.Update(PipelineSkipDoneMsg{URL: "https://jobs.example.com/low", Unreadable: true})
		if !strings.Contains(m.flash, `"- [ ] "`) || !strings.Contains(m.flash, "https://jobs.example.com/low") {
			t.Errorf("%s unreadable-row flash = %q, want the \"- [ ] \" rule and the URL", lang, m.flash)
		}
		m, _ = m.Update(PipelineSkipDoneMsg{URL: "https://jobs.example.com/low", Err: "boom"})
		if !strings.Contains(m.flash, "boom") {
			t.Errorf("%s failure flash = %q, want the error", lang, m.flash)
		}
		m, _ = m.Update(PipelineSkipDoneMsg{URL: "https://jobs.example.com/low"})
		if !strings.Contains(m.flash, "https://jobs.example.com/low") || !strings.Contains(m.flash, "u ") {
			t.Errorf("%s skip flash = %q, want the URL and the u hint", lang, m.flash)
		}
	}
}

func TestInboxUndoSurvivesATrackerReload(t *testing.T) {
	m := skipped(t)
	apps := inboxTrackerApps()
	reloaded := m.WithReloadedData(apps, data.ComputeMetrics(apps))
	if _, cmds := press(reloaded, "u"); cmds[0] == nil {
		t.Fatal("a reload forgot the skip u would undo")
	}
}

func TestXAndUDoNothingOnTheTrackerTabs(t *testing.T) {
	base := skipped(t) // u has something to undo
	for i, tab := range getPipelineTabs() {
		if tab.filter == filterPending {
			continue
		}
		for _, key := range []string{"x", "u"} {
			m := base
			m.activeTab = i
			m.applyFilterAndSort()
			m.cursor = 0
			m.flash = ""
			after, cmds := press(m, key)
			if cmds[0] != nil {
				t.Errorf("%s on the %s tab returned a command", key, tab.filter)
			}
			if after.flash != "" || after.statusPicker || after.colPicker || after.pdfPicker || after.discardPicker ||
				after.activeTab != m.activeTab || after.cursor != m.cursor || after.viewMode != m.viewMode ||
				after.pendingLastSkip != m.pendingLastSkip {
				t.Errorf("%s changed the %s tab", key, tab.filter)
			}
		}
	}
}

func TestInboxFooterAndKeyListOfferXAndU(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m.width = 400
	footer := ansi.Strip(m.renderHelp())
	m.keysHelp = true
	list := ansi.Strip(m.renderKeysHelp(100))
	for name, text := range map[string]string{"footer": footer, "? list": list} {
		for key, label := range map[string]string{"x": i18n.Current.HelpSkip, "u": i18n.Current.HelpUndoSkip} {
			if !helpOffersKey(text, key) || !strings.Contains(text, strings.TrimSpace(label)) {
				t.Errorf("Inbox %s does not offer %s:\n%s", name, key, text)
			}
		}
	}

	tracker := newInboxModel(t, inboxRows())
	tracker.width = 400
	footer = ansi.Strip(tracker.renderHelp())
	for _, key := range []string{"x", "u"} {
		if helpOffersKey(footer, key) {
			t.Errorf("tracker footer offers %s:\n%s", key, footer)
		}
	}
}
