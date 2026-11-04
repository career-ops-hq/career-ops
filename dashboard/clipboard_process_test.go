//go:build !windows

package main

import (
	"strings"
	"testing"
	"time"
)

// A clipboard utility that forks a background child holding stderr (as
// wl-copy and xclip do) must not keep runClipboardProcess waiting.
func TestRunClipboardProcessDoesNotWaitForBackgroundChild(t *testing.T) {
	done := make(chan error, 1)
	start := time.Now()
	go func() {
		done <- runClipboardProcess("sh", []string{"-c", "cat >/dev/null; (sleep 5 </dev/null >/dev/null &); exit 0"}, "/x.pdf")
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if d := time.Since(start); d > 3*time.Second {
			t.Fatalf("took %v: waited for the background child", d)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("runClipboardProcess blocked on a background child holding stderr")
	}
}

func TestRunClipboardProcessReportsStderrOnFailure(t *testing.T) {
	err := runClipboardProcess("sh", []string{"-c", "cat >/dev/null; echo 'no display' >&2; exit 1"}, "/x.pdf")
	if err == nil || !strings.Contains(err.Error(), "no display") {
		t.Fatalf("expected failure carrying stderr, got %v", err)
	}
}
