package main

import (
	"crypto/sha256"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/theme"
	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

// The Inbox tab (#5269) reads data/pipeline.md and the batch files and writes
// nothing. These tests drive the whole app, as a user would, against a
// fictional data root.

const inboxTestTracker = "# Applications Tracker\n\n" +
	"| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n" +
	"|---|------|---------|------|-------|--------|-----|--------|-------|\n" +
	"| 1 | 2026-10-01 | Globex | Engineer | 4.1/5 | Evaluated | ❌ | — | |\n"

const inboxTestPipeline = "# Pipeline\n\n## Pending\n\n" +
	"- [ ] https://jobs.example.com/acme/1 | Acme | Product Manager | Remote | posted: 2026-10-01 | rank: 4.2/5 — strong fit\n" +
	"- [ ] https://jobs.example.com/acme/2 | Acme | Data Analyst | Berlin\n" +
	"- [ ] local:jds/acme-writer.md | Acme | Technical Writer\n\n## Processed\n"

const inboxTestInput = "id\turl\tsource\tnotes\n1\thttps://jobs.example.com/acme/2\tpipeline\tAcme\n"

const inboxTestState = "id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n" +
	"1\thttps://jobs.example.com/acme/2\tfailed\t-\t-\t-\t-\tboom\t1\n"

func writeInboxRoot(t *testing.T) (string, []string) {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"path-resolver.mjs":     "// marker\n",
		"data/applications.md":  inboxTestTracker,
		"data/pipeline.md":      inboxTestPipeline,
		"batch/batch-input.tsv": inboxTestInput,
		"batch/batch-state.tsv": inboxTestState,
		"data/status-log.tsv":   "",
		"reports/.keep":         "",
		"output/.keep":          "",
	}
	var paths []string
	for rel, body := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, p)
	}
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Chdir(root)
	return root, paths
}

func newInboxApp(t *testing.T, root string) appModel {
	t.Helper()
	apps, err := data.ParseApplications(root)
	if err != nil {
		t.Fatal(err)
	}
	th := theme.NewTheme("auto")
	m := appModel{
		careerOpsPath: root,
		theme:         th,
		pipeline:      screens.NewPipelineModel(th, apps, data.ComputeMetrics(apps), root, 140, 40),
	}
	m.reloadPendingRows()
	return m
}

func keyMsg(k string) tea.KeyMsg {
	switch k {
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}
	case "left":
		return tea.KeyMsg{Type: tea.KeyLeft}
	case "right":
		return tea.KeyMsg{Type: tea.KeyRight}
	case "pgdown":
		return tea.KeyMsg{Type: tea.KeyPgDown}
	case "pgup":
		return tea.KeyMsg{Type: tea.KeyPgUp}
	case "ctrl+d":
		return tea.KeyMsg{Type: tea.KeyCtrlD}
	case "ctrl+u":
		return tea.KeyMsg{Type: tea.KeyCtrlU}
	}
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
}

// sendKey runs a key through the app and then the message its command
// produces, once, as Bubble Tea would. Commands that would leave the process
// (open a browser, quit) are recorded, never run.
func sendKey(t *testing.T, m appModel, k string) (appModel, []string) {
	t.Helper()
	var outside []string
	next, cmd := m.Update(keyMsg(k))
	m = next.(appModel)
	if cmd == nil {
		return m, nil
	}
	msg := cmd()
	switch msg := msg.(type) {
	case screens.PipelineOpenURLMsg:
		return m, append(outside, "open "+msg.URL)
	case screens.PipelineClosedMsg:
		return m, append(outside, "quit")
	case nil:
		return m, nil
	default:
		next, _ = m.Update(msg)
		return next.(appModel), outside
	}
}

func hashAll(t *testing.T, paths []string) map[string][32]byte {
	t.Helper()
	out := map[string][32]byte{}
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		out[p] = sha256.Sum256(b)
	}
	return out
}

func treeOf(t *testing.T, root string) string {
	t.Helper()
	var names []string
	if err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		names = append(names, p)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return strings.Join(names, "\n")
}

func TestInboxKeysChangeNoFile(t *testing.T) {
	// The key list presses the global `t` language toggle; put English back for later tests.
	t.Cleanup(func() { i18n.SetLang("en") })
	root, paths := writeInboxRoot(t)
	m := newInboxApp(t, root)
	if v := ansi.Strip(m.pipeline.View()); !strings.Contains(v, "ALL (1)") || !strings.Contains(v, "INBOX (3)") {
		t.Fatalf("startup view lacks ALL (1) / INBOX (3):\n%s", v)
	}
	before := hashAll(t, paths)
	tree := treeOf(t, root)

	m, _ = sendKey(t, m, "left") // ALL → Inbox
	keys := []string{
		"c", "d", "y", "D", "v", "C", "enter", "e", "x", "u", "i", "z",
		"j", "k", "g", "G", "pgdown", "pgup", "ctrl+d", "ctrl+u", "s", "s",
		"r", "m", "o", "j", "o", "j", "o",
		"/", "a", "c", "m", "e", "enter", "esc",
		"?", "j", "q",
		"t", "t", "t",
	}
	var opened []string
	for _, k := range keys {
		var outside []string
		m, outside = sendKey(t, m, k)
		opened = append(opened, outside...)
		if m.state != viewPipeline {
			// p and S are not in the list, so the app never leaves the tracker screen.
			t.Fatalf("%q left the pipeline screen", k)
		}
	}
	after := hashAll(t, paths)
	for _, p := range paths {
		if before[p] != after[p] {
			t.Errorf("%s changed", p)
		}
	}
	if got := treeOf(t, root); got != tree {
		t.Errorf("files were added or removed:\nbefore:\n%s\nafter:\n%s", tree, got)
	}
	for _, o := range opened {
		if o != "open https://jobs.example.com/acme/1" && o != "open https://jobs.example.com/acme/2" &&
			!strings.HasPrefix(o, "open https://career-ops.org/manifesto") {
			t.Errorf("the Inbox tried to %s", o)
		}
	}
}

func TestInboxReloadReadsTheFileAgainAndKeepsRowsOnFailure(t *testing.T) {
	root, _ := writeInboxRoot(t)
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left")

	pipeline := filepath.Join(root, "data", "pipeline.md")
	extra := strings.Replace(inboxTestPipeline, "\n\n## Processed",
		"\n- [ ] https://jobs.example.com/umbrella/9 | Umbrella | Support Lead\n\n## Processed", 1)
	if err := os.WriteFile(pipeline, []byte(extra), 0o644); err != nil {
		t.Fatal(err)
	}
	m, _ = sendKey(t, m, "r")
	view := ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, "INBOX (4)") || !strings.Contains(view, "Umbrella") {
		t.Fatalf("r did not show the file's current rows:\n%s", view)
	}
	if !strings.Contains(view, "━━━━━━━━━━━") || !strings.Contains(view, "RANK") {
		t.Fatalf("r left the Inbox:\n%s", view)
	}

	// Unreadable on the next reload: the rows stay and the error is shown.
	if err := os.Remove(pipeline); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(pipeline, 0o755); err != nil {
		t.Fatal(err)
	}
	next, _ := m.Update(screens.PipelineRefreshMsg{})
	m = next.(appModel)
	view = ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, "INBOX (4)") || !strings.Contains(view, "Umbrella") {
		t.Fatalf("a failed read dropped the Inbox rows:\n%s", view)
	}
	if !strings.Contains(view, "Inbox unavailable") {
		t.Fatalf("a failed read was not reported:\n%s", view)
	}

	// Removed altogether: that is an empty inbox, not an error.
	if err := os.Remove(pipeline); err != nil {
		t.Fatal(err)
	}
	next, _ = m.Update(screens.PipelineRefreshMsg{})
	m = next.(appModel)
	view = ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, "INBOX (0)") || strings.Contains(view, "Inbox unavailable") {
		t.Fatalf("a missing pipeline.md did not read as empty:\n%s", view)
	}
}

func TestInboxShowsBatchStatusFromTheFiles(t *testing.T) {
	root, _ := writeInboxRoot(t)
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left")
	view := ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, "Failed") {
		t.Fatalf("the failed batch row shows no status:\n%s", view)
	}
}
