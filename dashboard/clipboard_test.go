package main

import (
	"errors"
	"os/exec"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

type clipCall struct {
	name  string
	args  []string
	stdin string
}

// stubClipboard swaps the clipboard seams for the duration of a test.
// available lists binaries LookPath finds; failing lists those whose run errors.
func stubClipboard(t *testing.T, goos string, available, failing []string) *[]clipCall {
	t.Helper()
	prevGOOS, prevLook, prevRun := clipboardGOOS, clipboardLookPath, runClipboardCmd
	t.Cleanup(func() { clipboardGOOS, clipboardLookPath, runClipboardCmd = prevGOOS, prevLook, prevRun })

	has := func(list []string, n string) bool {
		for _, v := range list {
			if v == n {
				return true
			}
		}
		return false
	}
	var calls []clipCall
	clipboardGOOS = goos
	clipboardLookPath = func(name string) (string, error) {
		if has(available, name) {
			return "/usr/bin/" + name, nil
		}
		return "", exec.ErrNotFound
	}
	runClipboardCmd = func(name string, args []string, stdin string) error {
		calls = append(calls, clipCall{name, append([]string(nil), args...), stdin})
		if has(failing, name) {
			return errors.New("exit status 1")
		}
		return nil
	}
	return &calls
}

func TestCopyToClipboardPlatformCommands(t *testing.T) {
	cases := []struct{ goos, want string }{
		{"darwin", "pbcopy"},
		{"windows", "clip"},
		{"linux", "wl-copy"},
	}
	for _, tc := range cases {
		t.Run(tc.goos, func(t *testing.T) {
			calls := stubClipboard(t, tc.goos, []string{"pbcopy", "clip", "wl-copy", "xclip"}, nil)
			path := "/data/output/cv jane & co; rm -rf.pdf"
			if err := copyToClipboard(path); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(*calls) != 1 || (*calls)[0].name != tc.want {
				t.Fatalf("calls = %#v, want single %s", *calls, tc.want)
			}
			if (*calls)[0].stdin != path {
				t.Fatalf("stdin = %q, want path passed verbatim via stdin", (*calls)[0].stdin)
			}
			for _, a := range (*calls)[0].args {
				if strings.Contains(a, path) {
					t.Fatalf("path must not be passed as an argument: %#v", (*calls)[0].args)
				}
			}
		})
	}
}

func TestCopyToClipboardLinuxFallsBackToXclipWhenWlCopyMissing(t *testing.T) {
	calls := stubClipboard(t, "linux", []string{"xclip"}, nil)
	if err := copyToClipboard("/x.pdf"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(*calls) != 1 || (*calls)[0].name != "xclip" {
		t.Fatalf("calls = %#v, want xclip only", *calls)
	}
	if got := strings.Join((*calls)[0].args, " "); got != "-selection clipboard" {
		t.Fatalf("xclip args = %q", got)
	}
}

func TestCopyToClipboardLinuxFallsBackToXclipWhenWlCopyFails(t *testing.T) {
	calls := stubClipboard(t, "linux", []string{"wl-copy", "xclip"}, []string{"wl-copy"})
	if err := copyToClipboard("/x.pdf"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(*calls) != 2 || (*calls)[1].name != "xclip" {
		t.Fatalf("calls = %#v, want wl-copy then xclip", *calls)
	}
}

func TestCopyToClipboardMissingUtility(t *testing.T) {
	stubClipboard(t, "linux", nil, nil)
	err := copyToClipboard("/x.pdf")
	if err == nil || !strings.Contains(err.Error(), "no clipboard utility found") ||
		!strings.Contains(err.Error(), "wl-copy") || !strings.Contains(err.Error(), "xclip") {
		t.Fatalf("expected missing-utility error naming both tools, got %v", err)
	}
}

func TestCopyToClipboardUnsupportedOS(t *testing.T) {
	stubClipboard(t, "plan9", nil, nil)
	if err := copyToClipboard("/x.pdf"); err == nil {
		t.Fatal("expected an error on an unsupported OS")
	}
}

func TestCopyPathCmdReportsFailureNotSuccess(t *testing.T) {
	stubClipboard(t, "darwin", []string{"pbcopy"}, []string{"pbcopy"})
	msg := copyPathCmd("/x.pdf")()
	res, ok := msg.(screens.PipelineClipboardResultMsg)
	if !ok {
		t.Fatalf("got %T, want PipelineClipboardResultMsg", msg)
	}
	if res.Err == "" || !strings.Contains(res.Err, "pbcopy") {
		t.Fatalf("expected failure carrying pbcopy error, got %#v", res)
	}
}

func TestCopyPathCmdReportsSuccess(t *testing.T) {
	stubClipboard(t, "windows", []string{"clip"}, nil)
	res := copyPathCmd(`C:\out\cv.pdf`)().(screens.PipelineClipboardResultMsg)
	if res.Err != "" || res.Path != `C:\out\cv.pdf` {
		t.Fatalf("expected success for path, got %#v", res)
	}
}

// The clipboard result must reach the pipeline even if the user switched
// screens while the copy ran.
func TestClipboardResultReachesPipelineFromAnotherScreen(t *testing.T) {
	m, _ := newStatusTestModel(t)
	m.state = viewReport
	updated, _ := m.Update(screens.PipelineClipboardResultMsg{Path: "/out/cv.pdf"})
	got := updated.(appModel)
	if got.state != viewReport {
		t.Fatalf("state = %v, want the report viewer to stay open", got.state)
	}
	got.state = viewPipeline
	if view := got.View(); !strings.Contains(view, "Copied CV PDF path to clipboard") {
		t.Fatalf("pipeline did not receive the clipboard result, got %q", view)
	}
}
