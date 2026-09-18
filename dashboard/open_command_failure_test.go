//go:build darwin || linux

package main

import (
	"errors"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

// Issue 3913: the dashboard runs under a Bubble Tea alt-screen, so anything
// written to stderr is invisible. A failed open must come back as a message the
// pipeline screen can flash instead.
func TestOpenCmdReportsFailureAsMessage(t *testing.T) {
	previous := runOpenCommand
	defer func() { runOpenCommand = previous }()

	runOpenCommand = func(name string, args ...string) error {
		return errors.New("exec: \"xdg-open\": executable file not found in $PATH")
	}

	target := "https://example.com/jobs?id=1"
	msg := openCmd(target)()

	failed, ok := msg.(screens.PipelineOpenFailedMsg)
	if !ok {
		t.Fatalf("expected screens.PipelineOpenFailedMsg, got %T (%v)", msg, msg)
	}
	if failed.Target != target {
		t.Fatalf("Target = %q, want %q", failed.Target, target)
	}
	if failed.Err == "" {
		t.Fatal("expected a non-empty Err on the failure message")
	}
	if !strings.Contains(failed.Err, "xdg-open") {
		t.Fatalf("expected Err to carry the underlying error, got %q", failed.Err)
	}
}

func TestOpenCmdReturnsNilOnSuccess(t *testing.T) {
	previous := runOpenCommand
	defer func() { runOpenCommand = previous }()

	runOpenCommand = func(name string, args ...string) error { return nil }

	if msg := openCmd("https://example.com"); msg() != nil {
		t.Fatalf("expected no message on success, got %#v", msg())
	}
}
