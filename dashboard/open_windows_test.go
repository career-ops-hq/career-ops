//go:build windows

package main

import (
	"testing"

	"golang.org/x/sys/windows"
)

func TestOpenWithDefaultAppWindowsUsesShellExecute(t *testing.T) {
	previous := shellExecute
	defer func() { shellExecute = previous }()

	var called bool
	var gotVerb string
	var gotFile string
	var gotShowCmd int32
	shellExecute = func(_ windows.Handle, verb *uint16, file *uint16, _ *uint16, _ *uint16, showCmd int32) error {
		called = true
		gotVerb = windows.UTF16PtrToString(verb)
		gotFile = windows.UTF16PtrToString(file)
		gotShowCmd = showCmd
		return nil
	}

	target := "https://example.com/jobs?id=1&next=calc"
	if err := openWithDefaultApp(target); err != nil {
		t.Fatalf("openWithDefaultApp returned error: %v", err)
	}

	if !called {
		t.Fatal("ShellExecuteW was not called")
	}
	if gotVerb != "open" {
		t.Fatalf("verb = %q, want open", gotVerb)
	}
	if gotFile != target {
		t.Fatalf("file = %q, want exact target %q", gotFile, target)
	}
	if gotShowCmd != windows.SW_SHOWNORMAL {
		t.Fatalf("showCmd = %d, want %d", gotShowCmd, windows.SW_SHOWNORMAL)
	}
}
