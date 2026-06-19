//go:build darwin || linux

package main

import (
	"runtime"
	"testing"
)

func TestOpenWithDefaultAppUsesPlatformCommand(t *testing.T) {
	previous := runOpenCommand
	defer func() { runOpenCommand = previous }()

	var gotName string
	var gotArgs []string
	runOpenCommand = func(name string, args ...string) error {
		gotName = name
		gotArgs = append([]string(nil), args...)
		return nil
	}

	target := "https://example.com/jobs?id=1&next=2"
	if err := openWithDefaultApp(target); err != nil {
		t.Fatalf("openWithDefaultApp returned error: %v", err)
	}

	wantName := "xdg-open"
	if runtime.GOOS == "darwin" {
		wantName = "open"
	}
	if gotName != wantName {
		t.Fatalf("command name = %q, want %q", gotName, wantName)
	}
	if len(gotArgs) != 1 || gotArgs[0] != target {
		t.Fatalf("command args = %#v, want single target arg %q", gotArgs, target)
	}
}
