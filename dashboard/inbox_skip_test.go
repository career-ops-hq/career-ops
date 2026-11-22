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

// `x` on the Inbox (#5269) runs inbox-skip.mjs for the selected row, and `u`
// runs it with --undo for the last row skipped. A copy of this test executable
// stands in for node, records how it was run, and flips the checkbox in the
// --pipeline file the way the script would, so these tests drive the real
// process launch without Node.

type skipNodeCapture struct {
	Args []string
	Dir  string
	Root string
}

func init() {
	capture := os.Getenv("CAREER_OPS_TEST_SKIP_CAPTURE")
	if capture == "" {
		return
	}
	cwd, _ := os.Getwd()
	payload, _ := json.Marshal(skipNodeCapture{os.Args[1:], cwd, os.Getenv("CAREER_OPS_ROOT")})
	if err := os.WriteFile(capture, payload, 0o600); err != nil {
		os.Exit(1)
	}
	if line := os.Getenv("CAREER_OPS_TEST_SKIP_STDERR"); line != "" {
		_, _ = os.Stderr.WriteString(line + "\n")
	}
	if code := os.Getenv("CAREER_OPS_TEST_SKIP_EXIT"); code != "" {
		n, _ := strconv.Atoi(code)
		os.Exit(n)
	}
	var url, pipeline string
	undo := false
	for _, a := range os.Args[1:] {
		switch {
		case strings.HasPrefix(a, "--url="):
			url = strings.TrimPrefix(a, "--url=")
		case strings.HasPrefix(a, "--pipeline="):
			pipeline = strings.TrimPrefix(a, "--pipeline=")
		case a == "--undo":
			undo = true
		}
	}
	text, err := os.ReadFile(pipeline)
	if err != nil {
		os.Exit(1)
	}
	from, to := "- [ ] "+url+" ", "- [x] "+url+" "
	if undo {
		from, to = to, from
	}
	if err := os.WriteFile(pipeline, []byte(strings.Replace(string(text), from, to, 1)), 0o644); err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

// fakeSkipNode puts a copy of this test executable on PATH as `node` and
// returns the file it records its last invocation in.
func fakeSkipNode(t *testing.T) string {
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
	t.Setenv("CAREER_OPS_TEST_SKIP_CAPTURE", capture)
	return capture
}

func readSkipCapture(t *testing.T, capture string) skipNodeCapture {
	t.Helper()
	raw, err := os.ReadFile(capture)
	if err != nil {
		t.Fatalf("node was not run: %v", err)
	}
	var got skipNodeCapture
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	return got
}

// pressSkip presses a key on the Inbox and runs the two commands that follow:
// the screen's request, then main.go's script run.
func pressSkip(t *testing.T, m appModel, key string) appModel {
	t.Helper()
	next, cmd := m.Update(keyMsg(key))
	m = next.(appModel)
	if cmd == nil {
		t.Fatalf("%s on the Inbox returned no command", key)
	}
	req, ok := cmd().(screens.PipelineSkipMsg)
	if !ok {
		t.Fatalf("%s did not ask to skip or undo", key)
	}
	next, cmd = m.Update(req)
	m = next.(appModel)
	if cmd == nil {
		t.Fatal("the skip request started no script")
	}
	done, ok := cmd().(screens.PipelineSkipDoneMsg)
	if !ok {
		t.Fatal("the script run reported no outcome")
	}
	next, _ = m.Update(done)
	return next.(appModel)
}

func writeSkipScript(t *testing.T, root string) string {
	t.Helper()
	script := filepath.Join(root, "inbox-skip.mjs")
	if err := os.WriteFile(script, []byte("// stand-in\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return script
}

func TestInboxXAndURunInboxSkipForTheRow(t *testing.T) {
	root, _ := writeInboxRoot(t)
	script := writeSkipScript(t, root)
	capture := fakeSkipNode(t)
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left") // ALL → Inbox; the 4.2 row is first

	m = pressSkip(t, m, "x")

	got := readSkipCapture(t, capture)
	resolvedRoot, _ := filepath.EvalSymlinks(root)
	wantScript, _ := filepath.EvalSymlinks(script)
	if len(got.Args) != 3 {
		t.Fatalf("node args = %q, want the script, --url and --pipeline", got.Args)
	}
	if gotScript, _ := filepath.EvalSymlinks(got.Args[0]); gotScript != wantScript {
		t.Errorf("script = %q, want %q", got.Args[0], script)
	}
	if got.Args[1] != "--url=https://jobs.example.com/acme/1" {
		t.Errorf("url arg = %q", got.Args[1])
	}
	pipeline := strings.TrimPrefix(got.Args[2], "--pipeline=")
	if resolved, _ := filepath.EvalSymlinks(pipeline); !strings.HasPrefix(got.Args[2], "--pipeline=") || resolved != filepath.Join(resolvedRoot, "data", "pipeline.md") {
		t.Errorf("pipeline arg = %q, want the Inbox's data/pipeline.md", got.Args[2])
	}
	if dir, _ := filepath.EvalSymlinks(got.Dir); dir != resolvedRoot {
		t.Errorf("node ran in %q, want the checkout %q", got.Dir, root)
	}
	if r, _ := filepath.EvalSymlinks(got.Root); r != resolvedRoot {
		t.Errorf("CAREER_OPS_ROOT = %q, want %q", got.Root, root)
	}

	// The Inbox was read again: the skipped row has left it.
	view := ansi.Strip(m.pipeline.View())
	if m.state != viewPipeline || !strings.Contains(view, "INBOX (2)") || strings.Contains(view, "Product Manager") {
		t.Fatalf("the skipped row is still listed:\n%s", view)
	}
	if !strings.Contains(view, "Skipped; u puts it back") {
		t.Errorf("the footer does not report the skip:\n%s", view)
	}

	m, _ = sendKey(t, m, "j") // u does not depend on the selected row
	m = pressSkip(t, m, "u")

	got = readSkipCapture(t, capture)
	if len(got.Args) != 4 || got.Args[1] != "--url=https://jobs.example.com/acme/1" || got.Args[3] != "--undo" {
		t.Fatalf("u ran node with %q, want --url for the skipped row and --undo", got.Args)
	}
	view = ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, "INBOX (3)") || !strings.Contains(view, "Back in the Inbox") {
		t.Fatalf("the row did not come back:\n%s", view)
	}
	// The cursor is on the restored row: the preview shows its URL.
	if !strings.Contains(view, "URL: https://jobs.example.com/acme/1") {
		t.Errorf("the restored row is not selected:\n%s", view)
	}
	text, _ := os.ReadFile(filepath.Join(root, "data", "pipeline.md"))
	if string(text) != inboxTestPipeline {
		t.Errorf("skip and undo did not leave pipeline.md as it was:\n%s", text)
	}
}

func TestInboxXReportsAScriptFailure(t *testing.T) {
	root, paths := writeInboxRoot(t)
	writeSkipScript(t, root)
	fakeSkipNode(t)
	t.Setenv("CAREER_OPS_TEST_SKIP_STDERR", "data/pipeline.md is being written by another command right now. Try again.")
	t.Setenv("CAREER_OPS_TEST_SKIP_EXIT", "1")
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left")
	before := hashAll(t, paths)

	m = pressSkip(t, m, "x")

	view := ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, "being written by another command") || strings.Contains(view, "u puts it back") {
		t.Errorf("the script's error is not shown, or undo is offered:\n%s", view)
	}
	if !strings.Contains(view, "INBOX (3)") {
		t.Errorf("a failed skip changed the Inbox:\n%s", view)
	}
	after := hashAll(t, paths)
	for _, p := range paths {
		if before[p] != after[p] {
			t.Errorf("%s changed", p)
		}
	}
	// Nothing was skipped, so u has nothing to undo.
	next, cmd := m.Update(keyMsg("u"))
	if cmd != nil {
		t.Error("u after a failed skip asked for an undo")
	}
	if v := ansi.Strip(next.(appModel).pipeline.View()); !strings.Contains(v, "Nothing to undo") {
		t.Errorf("u after a failed skip does not say there is nothing to undo:\n%s", v)
	}
}

func TestInboxXNoOpAndUnreadableRow(t *testing.T) {
	for code, want := range map[string]string{
		"3": "Already skipped in data/pipeline.md, nothing changed",
		"4": `the URL must come first after "- [ ] "`,
	} {
		root, paths := writeInboxRoot(t)
		writeSkipScript(t, root)
		fakeSkipNode(t)
		t.Setenv("CAREER_OPS_TEST_SKIP_EXIT", code)
		m := newInboxApp(t, root)
		m, _ = sendKey(t, m, "left")
		before := hashAll(t, paths)

		m = pressSkip(t, m, "x")

		view := ansi.Strip(m.pipeline.View())
		if !strings.Contains(view, want) || strings.Contains(view, "u puts it back") {
			t.Errorf("exit %s is not reported as %q:\n%s", code, want, view)
		}
		after := hashAll(t, paths)
		for _, p := range paths {
			if before[p] != after[p] {
				t.Errorf("exit %s: %s changed", code, p)
			}
		}
	}
}

func TestInboxXWithNoScriptSaysSo(t *testing.T) {
	root, _ := writeInboxRoot(t) // no inbox-skip.mjs in this checkout
	capture := fakeSkipNode(t)
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left")

	m = pressSkip(t, m, "x")

	if _, err := os.Stat(capture); err == nil {
		t.Error("node ran with no script to run")
	}
	if view := ansi.Strip(m.pipeline.View()); !strings.Contains(view, "inbox-skip.mjs") {
		t.Errorf("the missing script is not named:\n%s", view)
	}
}
