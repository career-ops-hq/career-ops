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

// `a` ranks the selected Inbox row and `A` the unranked rows (#5269), each
// only after a `y`, because ranking spends the user's CLI tokens. The screen
// only asks; main.go runs rank-pipeline.mjs and reports back
// (inbox_rank_test.go drives that launch).

const unrankedURL = "local:jds/acme-unranked.md"

// rankRequest runs the command a key returned and checks it asks for a rank.
func rankRequest(t *testing.T, cmd tea.Cmd) PipelineRankMsg {
	t.Helper()
	if cmd == nil {
		t.Fatal("the key returned no command")
	}
	msg, ok := cmd().(PipelineRankMsg)
	if !ok {
		t.Fatalf("the key sent %#v, want PipelineRankMsg", cmd())
	}
	return msg
}

// unrankedRows is n Inbox rows with no rank.
func unrankedRows(n int) []data.PendingRow {
	rows := make([]data.PendingRow, n)
	for i := range rows {
		rows[i] = data.PendingRow{URL: fmt.Sprintf("https://jobs.example.com/u%d", i), Company: "Acme", Role: fmt.Sprintf("Role %d", i)}
	}
	return rows
}

func footer(m PipelineModel) string {
	m.width = 400
	return ansi.Strip(m.renderHelp())
}

func TestInboxAAsksBeforeRankingTheSelectedRow(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	m, _ = press(m, "G") // rank order: High, Low, Unranked
	asked, cmds := press(m, "a")
	if cmds[0] != nil {
		t.Fatal("a started a rank before the y")
	}
	if prompt := footer(asked); !strings.Contains(prompt, i18n.Current.InboxRankAskRow) || !strings.Contains(prompt, "tokens") {
		t.Fatalf("footer = %q, want the question with the tokens", prompt)
	}

	started, cmds := press(asked, "y")
	msg := rankRequest(t, cmds[0])
	if msg.URL != unrankedURL || msg.Limit != 0 || msg.CareerOpsPath != m.careerOpsPath {
		t.Fatalf("y asked for %+v, want the selected row under %s", msg, m.careerOpsPath)
	}
	if started.pendingRankAsk != nil || started.pendingRanking == nil {
		t.Fatal("y did not move the question to a running rank")
	}
	if started.flash != fmt.Sprintf(i18n.Current.InboxRanking, 1) {
		t.Fatalf("flash = %q, want InboxRanking for one row", started.flash)
	}
	if summary := ansi.Strip(started.renderPendingSummary()); !strings.Contains(summary, fmt.Sprintf(i18n.Current.InboxRankRunning, 1)) {
		t.Fatalf("summary = %q, want it to show the rank that runs", summary)
	}
}

func TestInboxRankQuestionCancelsOnAnyOtherKey(t *testing.T) {
	for _, key := range []string{"Y", "n", "esc", "enter", "q", "j", "a", "x"} {
		m := onInbox(t, newInboxModel(t, inboxRows()))
		m, _ = press(m, "G")
		m, _ = press(m, "a")
		after, cmds := press(m, key)
		if cmds[0] != nil {
			t.Errorf("%s after a returned a command (%T)", key, cmds[0]())
		}
		if after.pendingRankAsk != nil || after.pendingRanking != nil {
			t.Errorf("%s after a left a rank asked or running", key)
		}
		if after.cursor != m.cursor || !after.onPendingTab() {
			t.Errorf("%s after a also ran as a key", key)
		}
		if after.flash != i18n.Current.InboxRankCancelled {
			t.Errorf("%s after a flashed %q, want InboxRankCancelled", key, after.flash)
		}
	}
}

func TestInboxAOnARankedRowSaysSo(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows())) // High is selected and ranked
	after, cmds := press(m, "a")
	if cmds[0] != nil || after.pendingRankAsk != nil {
		t.Fatal("a on a ranked row asked to rank it")
	}
	if after.flash != fmt.Sprintf(i18n.Current.InboxRankAlready, "https://jobs.example.com/high") {
		t.Fatalf("flash = %q, want InboxRankAlready", after.flash)
	}
}

func TestInboxAOnAnEmptyInboxDoesNothing(t *testing.T) {
	m := onInbox(t, newInboxModel(t, nil))
	after, cmds := press(m, "a")
	if cmds[0] != nil || after.pendingRankAsk != nil || after.flash != "" {
		t.Fatalf("a on the empty Inbox: command %v, asked %v, flash %q", cmds[0] != nil, after.pendingRankAsk != nil, after.flash)
	}
}

func TestInboxCapitalAAsksForTheUnrankedRowsUpToTheLimit(t *testing.T) {
	cases := []struct {
		rows      []data.PendingRow
		count     int
		wantAsk   string
		wantLimit int
	}{
		{inboxRows(), 1, fmt.Sprintf(i18n.Current.InboxRankAskAll, 1), 1},
		{unrankedRows(pendingRankLimit), pendingRankLimit, fmt.Sprintf(i18n.Current.InboxRankAskAll, pendingRankLimit), pendingRankLimit},
		{unrankedRows(25), pendingRankLimit, fmt.Sprintf(i18n.Current.InboxRankAskSome, pendingRankLimit), pendingRankLimit},
	}
	for _, c := range cases {
		m := onInbox(t, newInboxModel(t, c.rows))
		asked, cmds := press(m, "A")
		if cmds[0] != nil {
			t.Fatal("A started a rank before the y")
		}
		if got := footer(asked); !strings.Contains(got, c.wantAsk) {
			t.Errorf("%d unranked: footer = %q, want %q", len(c.rows), got, c.wantAsk)
		}
		_, cmds = press(asked, "y")
		if msg := rankRequest(t, cmds[0]); msg.URL != "" || msg.Limit != c.wantLimit {
			t.Errorf("%d unranked: y asked for %+v, want every row up to %d", len(c.rows), msg, c.wantLimit)
		}
	}
}

func TestInboxCapitalAWithEveryRowRankedSaysSo(t *testing.T) {
	rows := []data.PendingRow{inboxRows()[0], inboxRows()[2]}
	m := onInbox(t, newInboxModel(t, rows))
	after, cmds := press(m, "A")
	if cmds[0] != nil || after.pendingRankAsk != nil || after.flash != i18n.Current.InboxRankNone {
		t.Fatalf("A with every row ranked: command %v, asked %v, flash %q", cmds[0] != nil, after.pendingRankAsk != nil, after.flash)
	}
}

func TestInboxRankKeysWaitForTheRunningRank(t *testing.T) {
	m := onInbox(t, newInboxModel(t, unrankedRows(3)))
	m, _ = press(m, "A", "y")
	for _, key := range []string{"a", "A"} {
		after, cmds := press(m, key)
		if cmds[0] != nil || after.pendingRankAsk != nil || after.flash != i18n.Current.InboxRankBusy {
			t.Errorf("%s while a rank runs: command %v, asked %v, flash %q", key, cmds[0] != nil, after.pendingRankAsk != nil, after.flash)
		}
	}
}

func TestInboxRankOutcomesInEveryLanguage(t *testing.T) {
	defer i18n.SetLang("en")
	const url = "https://jobs.example.com/u0"
	for _, lang := range []string{"en", "tr", "es"} {
		i18n.SetLang(lang)
		start := func(keys ...string) PipelineModel {
			m := onInbox(t, newInboxModel(t, unrankedRows(25)))
			m, _ = press(m, keys...)
			return m
		}

		// One row: main.go has reloaded, so the row carries its new rank.
		m := start("a", "y")
		ranked := unrankedRows(25)
		ranked[0].Rank, ranked[0].HasRank = 3.7, true
		m.SetPendingRows(ranked)
		m, _ = m.Update(PipelineRankDoneMsg{URL: url})
		if m.flash != fmt.Sprintf(i18n.Current.InboxRankedRow, 3.7, url) || m.pendingRanking != nil {
			t.Errorf("%s ranked-row flash = %q, running %v", lang, m.flash, m.pendingRanking != nil)
		}

		m = start("a", "y")
		m, _ = m.Update(PipelineRankDoneMsg{URL: url})
		if m.flash != fmt.Sprintf(i18n.Current.InboxRankNoScore, url) {
			t.Errorf("%s no-score flash = %q", lang, m.flash)
		}

		m = start("a", "y")
		m, _ = m.Update(PipelineRankDoneMsg{URL: url, NotPending: true})
		if !strings.Contains(m.flash, `"- [ ] "`) || !strings.Contains(m.flash, url) {
			t.Errorf("%s not-pending flash = %q, want the \"- [ ] \" rule and the URL", lang, m.flash)
		}

		m = start("A", "y")
		m, _ = m.Update(PipelineRankDoneMsg{Err: "boom"})
		if !strings.Contains(m.flash, "boom") || m.pendingRanking != nil {
			t.Errorf("%s failure flash = %q, running %v", lang, m.flash, m.pendingRanking != nil)
		}

		// Every row: 20 of 25 came back ranked, so 5 are left.
		m = start("A", "y")
		after := unrankedRows(25)
		for i := range 20 {
			after[i].Rank, after[i].HasRank = 3, true
		}
		m.SetPendingRows(after)
		m, _ = m.Update(PipelineRankDoneMsg{})
		if m.flash != fmt.Sprintf(i18n.Current.InboxRankedAll, 5) {
			t.Errorf("%s all-rows flash = %q", lang, m.flash)
		}

		// The reload after the run failed: the rows are the old ones, so
		// the outcome says the Inbox could not be read, not "no score".
		m = start("a", "y")
		m.pendingErr = "permission denied"
		m, _ = m.Update(PipelineRankDoneMsg{URL: url})
		if m.flash != fmt.Sprintf(i18n.Current.InboxRankReadFailed, "permission denied") {
			t.Errorf("%s read-failed flash = %q", lang, m.flash)
		}
	}
}

func TestInboxRankStateSurvivesATrackerReload(t *testing.T) {
	apps := inboxTrackerApps()
	m := onInbox(t, newInboxModel(t, unrankedRows(3)))
	asked, _ := press(m, "A")
	if reloaded := asked.WithReloadedData(apps, data.ComputeMetrics(apps)); reloaded.pendingRankAsk == nil {
		t.Fatal("a reload dropped the question")
	}
	running, _ := press(asked, "y")
	if reloaded := running.WithReloadedData(apps, data.ComputeMetrics(apps)); reloaded.pendingRanking == nil {
		t.Fatal("a reload forgot the rank that runs")
	}
}

func TestAAndCapitalADoNothingOnTheTrackerTabs(t *testing.T) {
	base := newInboxModel(t, unrankedRows(3))
	for i, tab := range getPipelineTabs() {
		if tab.filter == filterPending {
			continue
		}
		for _, key := range []string{"a", "A"} {
			m := base
			m.activeTab = i
			m.applyFilterAndSort()
			m.cursor = 0
			after, cmds := press(m, key)
			if cmds[0] != nil || after.pendingRankAsk != nil || after.flash != "" {
				t.Errorf("%s on the %s tab: command %v, asked %v, flash %q", key, tab.filter, cmds[0] != nil, after.pendingRankAsk != nil, after.flash)
			}
		}
	}
}

func TestInboxFooterAndKeyListOfferAAndCapitalA(t *testing.T) {
	m := onInbox(t, newInboxModel(t, inboxRows()))
	bar := footer(m)
	m.keysHelp = true
	for name, text := range map[string]string{"footer": bar, "? list": ansi.Strip(m.renderKeysHelp(100))} {
		for key, label := range map[string]string{"a": i18n.Current.HelpRankRow, "A": i18n.Current.HelpRankAll} {
			if !helpOffersKey(text, key) || !strings.Contains(text, strings.TrimSpace(label)) {
				t.Errorf("Inbox %s does not offer %s:\n%s", name, key, text)
			}
		}
	}
	tracker := newInboxModel(t, inboxRows())
	for _, key := range []string{"a", "A"} {
		if helpOffersKey(footer(tracker), key) {
			t.Errorf("tracker footer offers %s:\n%s", key, footer(tracker))
		}
	}
}

// The footer keeps the start and the end of a line that is too wide and cuts
// the middle, which would drop the controls. Every question fits 80 columns
// whole, in every language, at the largest count `A` can ask about.
func TestInboxRankQuestionsFitEightyColumns(t *testing.T) {
	defer i18n.SetLang("en")
	for _, lang := range []string{"en", "tr", "es"} {
		i18n.SetLang(lang)
		for name, rows := range map[string][]data.PendingRow{
			"a":           unrankedRows(1),
			"A, all":      unrankedRows(pendingRankLimit),
			"A, the next": unrankedRows(999),
		} {
			m := onInbox(t, newInboxModel(t, rows))
			key := "A"
			if name == "a" {
				key = "a"
			}
			m, _ = press(m, key)
			want := m.rankPrompt()
			m.width = 80
			got := ansi.Strip(m.renderHelp())
			if !strings.Contains(got, want) || !strings.Contains(want, "y: ") {
				t.Errorf("%s %s: the 80-column footer %q does not hold the whole question %q", lang, name, got, want)
			}
			if width := ansi.StringWidth(got); width > 80 {
				t.Errorf("%s %s: the footer is %d columns wide, want at most 80: %q", lang, name, width, got)
			}
		}
	}
}
