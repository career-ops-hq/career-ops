package screens

import (
	"fmt"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
)

// `e` on the Inbox queues the selected row (#5269). The screen only asks for
// it; main.go runs sync-batch-input.mjs --url and reports back.

func TestInboxEQueuesTheSelectedRow(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m, _ = press(m, "j") // rank order: High (queued), Low, Unranked; select Low
	after, cmds := press(m, "e")
	if cmds[0] == nil {
		t.Fatal("e on an unqueued http(s) row returned no command")
	}
	msg, ok := cmds[0]().(PipelineQueueEvalMsg)
	if !ok {
		t.Fatalf("e sent %#v, want PipelineQueueEvalMsg", cmds[0]())
	}
	if msg.URL != "https://jobs.example.com/low" || msg.CareerOpsPath != m.careerOpsPath {
		t.Fatalf("e asked to queue %+v, want the selected row under %s", msg, m.careerOpsPath)
	}
	if !after.onPendingTab() || after.cursor != m.cursor {
		t.Fatal("e moved off the selected Inbox row")
	}
	if !strings.Contains(after.flash, "https://jobs.example.com/low") {
		t.Fatalf("flash = %q, want it to name the row being queued", after.flash)
	}
}

func TestInboxESkipsARowTheBatchFilesAlreadyHold(t *testing.T) {
	for _, status := range pendingStatuses {
		m := onInbox(t, newInboxModel(t, []data.PendingRow{{URL: "https://jobs.example.com/a", Company: "Acme", Role: "Role", Status: status}}))
		after, cmds := press(m, "e")
		if cmds[0] != nil {
			t.Errorf("e on a %s row returned a command", status)
		}
		if !strings.Contains(after.flash, "https://jobs.example.com/a") {
			t.Errorf("e on a %s row flashed %q, want the URL", status, after.flash)
		}
		// Only a Failed row points at the runner's retry flag; it exists in
		// batch/batch-runner.sh as --retry-failed.
		if hint := strings.Contains(after.flash, "batch/batch-runner.sh --retry-failed"); hint != (status == data.PendingStatusFailed) {
			t.Errorf("e on a %s row flashed %q; retry hint shown = %v", status, after.flash, hint)
		}
	}
}

func TestInboxQueueNoOpAndUnreadableRowAreNotReportedAsQueued(t *testing.T) {
	defer i18n.SetLang("en")
	for _, lang := range []string{"en", "tr", "es"} {
		i18n.SetLang(lang)
		m := onInbox(t, newInboxModel(t, inboxRows()))
		m, _ = m.Update(PipelineQueueEvalDoneMsg{URL: "https://jobs.example.com/low", Already: true})
		if m.flash != fmt.Sprintf(i18n.Current.InboxQueueAlready, "https://jobs.example.com/low") {
			t.Errorf("%s no-op flash = %q, want InboxQueueAlready", lang, m.flash)
		}
		m, _ = m.Update(PipelineQueueEvalDoneMsg{URL: "https://jobs.example.com/low", Unreadable: true})
		if !strings.Contains(m.flash, `"- [ ] "`) || !strings.Contains(m.flash, "https://jobs.example.com/low") {
			t.Errorf("%s unreadable-row flash = %q, want the \"- [ ] \" rule and the URL", lang, m.flash)
		}
		for _, f := range []string{fmt.Sprintf(i18n.Current.InboxQueueAlready, "x"), m.flash} {
			if strings.Contains(f, "batch-runner.sh") {
				t.Errorf("%s flash %q says to run the batch although nothing was queued", lang, f)
			}
		}
	}
}

func TestInboxERefusesARowThatIsNotAWebAddress(t *testing.T) {
	for _, target := range []string{"local:jds/acme-unranked.md", "javascript:alert(1)", "https://"} {
		m := onInbox(t, newInboxModel(t, []data.PendingRow{{URL: target, Company: "Acme", Role: "Odd"}}))
		after, cmds := press(m, "e")
		if cmds[0] != nil {
			t.Errorf("e on %q returned a command", target)
		}
		if !strings.Contains(after.flash, target) {
			t.Errorf("e on %q flashed %q, want it to name the target", target, after.flash)
		}
	}
}

func TestInboxEOnAnEmptyInboxDoesNothing(t *testing.T) {
	m := onInbox(t, newInboxModel(t, nil))
	after, cmds := press(m, "e")
	if cmds[0] != nil || after.flash != "" {
		t.Fatalf("e on the empty Inbox: command %v, flash %q", cmds[0] != nil, after.flash)
	}
}

func TestEDoesNothingOnTheTrackerTabs(t *testing.T) {
	base := newInboxModel(t, inboxRows())
	for i, tab := range getPipelineTabs() {
		if tab.filter == filterPending {
			continue
		}
		m := base
		m.activeTab = i
		m.applyFilterAndSort()
		m.cursor = 0
		after, cmds := press(m, "e")
		if cmds[0] != nil {
			t.Errorf("e on the %s tab returned a command", tab.filter)
		}
		if after.flash != "" || after.statusPicker || after.colPicker || after.pdfPicker || after.discardPicker ||
			after.activeTab != m.activeTab || after.cursor != m.cursor || after.viewMode != m.viewMode {
			t.Errorf("e changed the %s tab", tab.filter)
		}
	}
}

func TestInboxQueueOutcomeIsFlashed(t *testing.T) {
	defer i18n.SetLang("en")
	for _, lang := range []string{"en", "tr", "es"} {
		i18n.SetLang(lang)
		m := onInbox(t, newInboxModel(t, inboxRows()))
		m, _ = m.Update(PipelineQueueEvalDoneMsg{URL: "https://jobs.example.com/low"})
		if !strings.Contains(m.flash, "batch/batch-runner.sh") {
			t.Errorf("%s success flash = %q, want it to name batch/batch-runner.sh", lang, m.flash)
		}
	}

	m := onInbox(t, newInboxModel(t, inboxRows()))
	m, cmd := m.Update(PipelineQueueEvalDoneMsg{URL: "https://jobs.example.com/low", Err: "Not an unchecked Pending row in data/pipeline.md: https://jobs.example.com/low"})
	if cmd != nil {
		t.Fatal("a failed queue request returned a command")
	}
	if !strings.Contains(m.flash, "Not an unchecked Pending row") || strings.Contains(m.flash, "batch-runner.sh") {
		t.Fatalf("failure flash = %q, want the script's error and no run hint", m.flash)
	}
	if len(m.pendingView) != 3 || !m.onPendingTab() {
		t.Fatal("a failed queue request changed the Inbox")
	}
	if help := ansi.Strip(m.renderHelp()); !strings.Contains(help, "Not an unchecked Pending row") {
		t.Fatalf("footer = %q, want the error", help)
	}
}

func TestInboxFooterAndKeyListOfferE(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m.width = 400
	footer := ansi.Strip(m.renderHelp())
	m.keysHelp = true
	list := ansi.Strip(m.renderKeysHelp(100))
	for name, text := range map[string]string{"footer": footer, "? list": list} {
		if !helpOffersKey(text, "e") || !strings.Contains(text, strings.TrimSpace(i18n.Current.HelpQueue)) {
			t.Errorf("Inbox %s does not offer e:\n%s", name, text)
		}
	}

	tracker := newInboxModel(t, inboxRows())
	tracker.width = 400
	if footer := ansi.Strip(tracker.renderHelp()); helpOffersKey(footer, "e") {
		t.Errorf("tracker footer offers e:\n%s", footer)
	}
}
