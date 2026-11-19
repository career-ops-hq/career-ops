//go:build darwin || linux

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

// `a` on the Inbox (#5269) runs rank-pipeline.mjs --url for the selected row
// and `A` runs it with --limit, each after a `y`. A copy of this test
// executable stands in for node, records how it was run, and writes a rank
// cell into $CAREER_OPS_ROOT/data/pipeline.md the way the script would, so
// these tests drive the real process launch without Node or an agent CLI.

const fakeRankCell = " | rank: 3.5/5 — fake fit"

type rankNodeCapture struct {
	Args []string
	Dir  string
	Root string
}

func init() {
	capture := os.Getenv("CAREER_OPS_TEST_RANK_CAPTURE")
	if capture == "" {
		return
	}
	cwd, _ := os.Getwd()
	root := os.Getenv("CAREER_OPS_ROOT")
	payload, _ := json.Marshal(rankNodeCapture{os.Args[1:], cwd, root})
	if err := os.WriteFile(capture, payload, 0o600); err != nil {
		os.Exit(1)
	}
	if line := os.Getenv("CAREER_OPS_TEST_RANK_STDERR"); line != "" {
		_, _ = os.Stderr.WriteString(line + "\n")
	}
	if code := os.Getenv("CAREER_OPS_TEST_RANK_EXIT"); code != "" {
		n, _ := strconv.Atoi(code)
		os.Exit(n)
	}
	url, limit := "", 0
	for _, a := range os.Args[1:] {
		switch {
		case strings.HasPrefix(a, "--url="):
			url = strings.TrimPrefix(a, "--url=")
		case strings.HasPrefix(a, "--limit="):
			limit, _ = strconv.Atoi(strings.TrimPrefix(a, "--limit="))
		}
	}
	pipeline := filepath.Join(root, "data", "pipeline.md")
	text, err := os.ReadFile(pipeline)
	if err != nil {
		os.Exit(1)
	}
	lines := strings.Split(string(text), "\n")
	for i, line := range lines {
		if !strings.HasPrefix(line, "- [ ] ") || strings.Contains(line, "| rank: ") {
			continue
		}
		if url != "" && !strings.HasPrefix(line, "- [ ] "+url+" ") {
			continue
		}
		if url == "" && limit == 0 {
			break
		}
		lines[i] = line + fakeRankCell
		limit--
	}
	if err := os.WriteFile(pipeline, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

// fakeRankNode puts a copy of this test executable on PATH as `node` and
// returns the file it records its last invocation in.
func fakeRankNode(t *testing.T) string {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	binDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(binDir, "node"), binary, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	capture := filepath.Join(t.TempDir(), "capture.json")
	t.Setenv("CAREER_OPS_TEST_RANK_CAPTURE", capture)
	return capture
}

func readRankCapture(t *testing.T, capture string) rankNodeCapture {
	t.Helper()
	raw, err := os.ReadFile(capture)
	if err != nil {
		t.Fatalf("node was not run: %v", err)
	}
	var got rankNodeCapture
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	return got
}

func writeRankScript(t *testing.T, root string) string {
	t.Helper()
	script := filepath.Join(root, "rank-pipeline.mjs")
	if err := os.WriteFile(script, []byte("// stand-in\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return script
}

// pressRank presses a key on the Inbox, answers its question with `y`, and
// runs the two commands that follow: the screen's request, then main.go's
// script run.
func pressRank(t *testing.T, m appModel, key string) appModel {
	t.Helper()
	next, cmd := m.Update(keyMsg(key))
	m = next.(appModel)
	if cmd != nil {
		t.Fatalf("%s on the Inbox started something before the y", key)
	}
	next, cmd = m.Update(keyMsg("y"))
	m = next.(appModel)
	if cmd == nil {
		t.Fatalf("y after %s returned no command", key)
	}
	req, ok := cmd().(screens.PipelineRankMsg)
	if !ok {
		t.Fatalf("y after %s did not ask to rank", key)
	}
	next, cmd = m.Update(req)
	m = next.(appModel)
	if cmd == nil {
		t.Fatal("the rank request started no script")
	}
	done, ok := cmd().(screens.PipelineRankDoneMsg)
	if !ok {
		t.Fatal("the script run reported no outcome")
	}
	next, _ = m.Update(done)
	return next.(appModel)
}

func TestInboxARunsRankPipelineForTheRow(t *testing.T) {
	root, _ := writeInboxRoot(t)
	script := writeRankScript(t, root)
	capture := fakeRankNode(t)
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left") // ALL → Inbox; the 4.2 row is first
	m, _ = sendKey(t, m, "j")    // the first unranked row

	m = pressRank(t, m, "a")

	got := readRankCapture(t, capture)
	resolvedRoot, _ := filepath.EvalSymlinks(root)
	wantScript, _ := filepath.EvalSymlinks(script)
	if len(got.Args) != 2 {
		t.Fatalf("node args = %q, want the script and --url", got.Args)
	}
	if gotScript, _ := filepath.EvalSymlinks(got.Args[0]); gotScript != wantScript {
		t.Errorf("script = %q, want %q", got.Args[0], script)
	}
	if got.Args[1] != "--url=https://jobs.example.com/acme/2" {
		t.Errorf("url arg = %q", got.Args[1])
	}
	if dir, _ := filepath.EvalSymlinks(got.Dir); dir != resolvedRoot {
		t.Errorf("node ran in %q, want the checkout %q", got.Dir, root)
	}
	if r, _ := filepath.EvalSymlinks(got.Root); r != resolvedRoot {
		t.Errorf("CAREER_OPS_ROOT = %q, want %q", got.Root, root)
	}

	// The Inbox was read again: the row shows its new rank.
	view := ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, "Ranked 3.5/5: https://jobs.example.com/acme/2") {
		t.Errorf("the footer does not report the new rank:\n%s", view)
	}
	if !strings.Contains(view, "3 pending · 1 not ranked") {
		t.Errorf("the summary does not count the ranked row:\n%s", view)
	}
}

func TestInboxCapitalARanksTheUnrankedRows(t *testing.T) {
	root, _ := writeInboxRoot(t)
	writeRankScript(t, root)
	capture := fakeRankNode(t)
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left")

	next, _ := m.Update(keyMsg("A"))
	if view := ansi.Strip(next.(appModel).pipeline.View()); !strings.Contains(view, "Rank 2 row(s) with your agent CLI? Uses tokens. y: yes, other key: no") {
		t.Fatalf("A does not ask about the two unranked rows:\n%s", view)
	}
	m = pressRank(t, m, "A")

	if got := readRankCapture(t, capture); len(got.Args) != 2 || got.Args[1] != "--limit=2" {
		t.Fatalf("node args = %q, want the script and --limit=2", got.Args)
	}
	view := ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, "Rank run finished; 0 row(s) still not ranked") || !strings.Contains(view, "3 pending · 0 not ranked") {
		t.Errorf("the footer or summary does not report the run:\n%s", view)
	}
}

func TestInboxRankFailureAndMissedRow(t *testing.T) {
	for code, want := range map[string]string{
		"1": "Every call to claude failed",
		"4": `the URL must come first after "- [ ] "`,
	} {
		root, paths := writeInboxRoot(t)
		writeRankScript(t, root)
		fakeRankNode(t)
		t.Setenv("CAREER_OPS_TEST_RANK_STDERR", "Every call to claude failed. Check that `claude` works on its own.")
		t.Setenv("CAREER_OPS_TEST_RANK_EXIT", code)
		m := newInboxApp(t, root)
		m, _ = sendKey(t, m, "left")
		m, _ = sendKey(t, m, "j")
		before := hashAll(t, paths)

		m = pressRank(t, m, "a")

		view := ansi.Strip(m.pipeline.View())
		if !strings.Contains(view, want) {
			t.Errorf("exit %s is not reported as %q:\n%s", code, want, view)
		}
		after := hashAll(t, paths)
		for _, p := range paths {
			if before[p] != after[p] {
				t.Errorf("exit %s: %s changed", code, p)
			}
		}
		// The run is over, so a can ask again.
		next, _ := m.Update(keyMsg("a"))
		if v := ansi.Strip(next.(appModel).pipeline.View()); strings.Contains(v, "already running") {
			t.Errorf("exit %s left the rank marked as running:\n%s", code, v)
		}
	}
}

func TestInboxAWithNoScriptSaysSo(t *testing.T) {
	root, _ := writeInboxRoot(t) // no rank-pipeline.mjs in this checkout
	capture := fakeRankNode(t)
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left")
	m, _ = sendKey(t, m, "j")

	m = pressRank(t, m, "a")

	if _, err := os.Stat(capture); err == nil {
		t.Error("node ran with no script to run")
	}
	if view := ansi.Strip(m.pipeline.View()); !strings.Contains(view, "rank-pipeline.mjs") {
		t.Errorf("the missing script is not named:\n%s", view)
	}
}
