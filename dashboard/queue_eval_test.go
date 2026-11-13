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

// `e` on the Inbox (#5269) runs sync-batch-input.mjs --url for the selected
// row. A copy of this test executable stands in for node, records how it was
// run, and appends to batch-input.tsv the way the script would, so these
// tests drive the real process launch without Node.

type queueNodeCapture struct {
	Args []string
	Dir  string
	Root string
}

func init() {
	capture := os.Getenv("CAREER_OPS_TEST_QUEUE_CAPTURE")
	if capture == "" {
		return
	}
	cwd, _ := os.Getwd()
	payload, _ := json.Marshal(queueNodeCapture{os.Args[1:], cwd, os.Getenv("CAREER_OPS_ROOT")})
	if err := os.WriteFile(capture, payload, 0o600); err != nil {
		os.Exit(1)
	}
	if line := os.Getenv("CAREER_OPS_TEST_QUEUE_STDOUT"); line != "" {
		_, _ = os.Stdout.WriteString(line + "\n")
	}
	if line := os.Getenv("CAREER_OPS_TEST_QUEUE_STDERR"); line != "" {
		_, _ = os.Stderr.WriteString(line + "\n")
	}
	if code := os.Getenv("CAREER_OPS_TEST_QUEUE_EXIT"); code != "" {
		n, _ := strconv.Atoi(code)
		os.Exit(n)
	}
	if row := os.Getenv("CAREER_OPS_TEST_QUEUE_APPEND"); row != "" {
		f, err := os.OpenFile(filepath.Join(cwd, "batch", "batch-input.tsv"), os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			os.Exit(1)
		}
		_, _ = f.WriteString(row + "\n")
		_ = f.Close()
	}
	_, _ = os.Stdout.WriteString("Run `./batch/batch-runner.sh` to evaluate them.\n")
	os.Exit(0)
}

// fakeQueueNode puts a copy of this test executable on PATH as `node` and
// returns the file it records its invocation in.
func fakeQueueNode(t *testing.T) string {
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
	t.Setenv("CAREER_OPS_TEST_QUEUE_CAPTURE", capture)
	return capture
}

// pressQueue presses e on the Inbox and runs the two commands that follow:
// the screen's request, then main.go's script run.
func pressQueue(t *testing.T, m appModel) appModel {
	t.Helper()
	next, cmd := m.Update(keyMsg("e"))
	m = next.(appModel)
	if cmd == nil {
		t.Fatal("e on the Inbox returned no command")
	}
	req, ok := cmd().(screens.PipelineQueueEvalMsg)
	if !ok {
		t.Fatal("e did not ask to queue the row")
	}
	next, cmd = m.Update(req)
	m = next.(appModel)
	if cmd == nil {
		t.Fatal("the queue request started no script")
	}
	done, ok := cmd().(screens.PipelineQueueEvalDoneMsg)
	if !ok {
		t.Fatal("the script run reported no outcome")
	}
	next, _ = m.Update(done)
	return next.(appModel)
}

func writeQueueScript(t *testing.T, root string) string {
	t.Helper()
	script := filepath.Join(root, "sync-batch-input.mjs")
	if err := os.WriteFile(script, []byte("// stand-in\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return script
}

func TestInboxERunsSyncBatchInputForTheSelectedRow(t *testing.T) {
	root, _ := writeInboxRoot(t)
	script := writeQueueScript(t, root)
	capture := fakeQueueNode(t)
	t.Setenv("CAREER_OPS_TEST_QUEUE_APPEND", "2\thttps://jobs.example.com/acme/1\tpipeline\trank: 4.2/5 — strong fit")
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left") // ALL → Inbox; the 4.2 row is first and not queued

	m = pressQueue(t, m)

	raw, err := os.ReadFile(capture)
	if err != nil {
		t.Fatalf("node was not run: %v", err)
	}
	var got queueNodeCapture
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
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
	for _, a := range got.Args {
		if strings.Contains(a, "batch-runner") {
			t.Errorf("the dashboard passed %q; it must never run the batch", a)
		}
	}

	if m.state != viewPipeline {
		t.Fatal("e left the pipeline screen")
	}
	view := ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, "batch/batch-runner.sh") {
		t.Errorf("the footer does not name batch/batch-runner.sh:\n%s", view)
	}
	// The Inbox was read again, so the row now shows what batch-input.tsv holds.
	found := false
	for _, line := range strings.Split(view, "\n") {
		if strings.Contains(line, "Product Manager") {
			found = true
			if !strings.Contains(line, "Queued") {
				t.Errorf("the queued row does not show Queued after the reload: %q", line)
			}
		}
	}
	if !found {
		t.Errorf("the queued row is not listed:\n%s", view)
	}
}

func TestInboxEReportsAScriptFailure(t *testing.T) {
	root, paths := writeInboxRoot(t)
	writeQueueScript(t, root)
	fakeQueueNode(t)
	t.Setenv("CAREER_OPS_TEST_QUEUE_STDERR", "Error: could not acquire the batch-input lock")
	t.Setenv("CAREER_OPS_TEST_QUEUE_EXIT", "1")
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left")
	before := hashAll(t, paths)

	m = pressQueue(t, m)

	if m.state != viewPipeline {
		t.Fatal("a failed queue request left the pipeline screen")
	}
	view := ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, "could not acquire the batch-input lock") {
		t.Errorf("the script's error is not shown:\n%s", view)
	}
	if strings.Contains(view, "batch-runner.sh") {
		t.Errorf("a failed queue request still says to run the batch:\n%s", view)
	}
	if !strings.Contains(view, "INBOX (3)") {
		t.Errorf("a failed queue request changed the Inbox:\n%s", view)
	}
	after := hashAll(t, paths)
	for _, p := range paths {
		if before[p] != after[p] {
			t.Errorf("%s changed", p)
		}
	}
}

func TestInboxENoOpIsNotReportedAsQueued(t *testing.T) {
	// The URL is only in batch-state.tsv, so the Inbox shows no status and
	// sends it; the script finds it already processed and exits 3.
	root, paths := writeInboxRoot(t)
	writeQueueScript(t, root)
	fakeQueueNode(t)
	t.Setenv("CAREER_OPS_TEST_QUEUE_STDOUT", "https://jobs.example.com/acme/1 is already in batch-input.tsv or batch-state.tsv — nothing to queue.")
	t.Setenv("CAREER_OPS_TEST_QUEUE_EXIT", "3")
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left")
	before := hashAll(t, paths)

	m = pressQueue(t, m)

	view := ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, "Already in the batch files, nothing queued") || strings.Contains(view, "batch-runner.sh") {
		t.Errorf("a no-op is not reported as one:\n%s", view)
	}
	after := hashAll(t, paths)
	for _, p := range paths {
		if before[p] != after[p] {
			t.Errorf("%s changed", p)
		}
	}
}

func TestInboxEUnreadableRowSaysTheURLMustComeFirst(t *testing.T) {
	root, _ := writeInboxRoot(t)
	writeQueueScript(t, root)
	fakeQueueNode(t)
	t.Setenv("CAREER_OPS_TEST_QUEUE_STDERR", "Not an unchecked Pending row in data/pipeline.md: https://jobs.example.com/acme/1")
	t.Setenv("CAREER_OPS_TEST_QUEUE_EXIT", "4")
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left")

	m = pressQueue(t, m)

	view := ansi.Strip(m.pipeline.View())
	if !strings.Contains(view, `the URL must come first after "- [ ] "`) || strings.Contains(view, "batch-runner.sh") {
		t.Errorf("an unreadable row does not say the URL must come first:\n%s", view)
	}
}

func TestInboxEWithNoScriptSaysSo(t *testing.T) {
	root, _ := writeInboxRoot(t) // no sync-batch-input.mjs in this checkout
	capture := fakeQueueNode(t)
	m := newInboxApp(t, root)
	m, _ = sendKey(t, m, "left")

	m = pressQueue(t, m)

	if _, err := os.Stat(capture); err == nil {
		t.Error("node ran with no script to run")
	}
	if view := ansi.Strip(m.pipeline.View()); !strings.Contains(view, "sync-batch-input.mjs") {
		t.Errorf("the missing script is not named:\n%s", view)
	}
}
