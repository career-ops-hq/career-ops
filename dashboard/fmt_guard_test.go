package main

import (
	"go/format"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The Go tree stays gofmt-clean.
//
// `go test ./...` is the only Go step in CI, so formatting drift was never
// caught — two files were unformatted on main when this was written
// (internal/data/stats.go and internal/ui/screens/stats.go). Neither was
// anybody's fault in an obvious way: one was a map literal whose alignment
// shifts because a key contains a multi-byte "≥", and the other was
// `2 * radius` where gofmt wants `2*radius`. Exactly the kind of thing a human
// reviewer should never have to spend attention on.
//
// A test rather than a workflow step, so it runs under the existing `go test
// ./...` with no CI change, and so `go test` locally tells you before the push
// does.
//
// go/format rather than shelling out to the gofmt binary: same result, no
// dependency on what is installed on PATH.
func TestGoTreeIsGofmtClean(t *testing.T) {
	var offenders []string
	checked := 0

	root, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}

	err = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			// A second checkout parked under the tree is not this module's
			// source; testdata is fixture input and may be deliberately odd.
			if d.Name() == "testdata" || d.Name() == "node_modules" {
				return filepath.SkipDir
			}
			if _, statErr := os.Stat(filepath.Join(path, ".git")); statErr == nil && path != root {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}

		src, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		want, fmtErr := format.Source(src)
		if fmtErr != nil {
			// Unparseable Go is a different failure, and `go build` already
			// reports it far better than this test could.
			return nil
		}
		checked++
		if string(want) != string(src) {
			rel, _ := filepath.Rel(root, path)
			offenders = append(offenders, rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}

	// A guard on the guard: if the walk ever stops finding files, every
	// assertion below would pass over an empty list and report as coverage.
	if checked < 20 {
		t.Fatalf("only %d .go files checked — the walk has lost its subject", checked)
	}

	if len(offenders) > 0 {
		t.Errorf("%d file(s) are not gofmt-clean; run `gofmt -w .` in dashboard/:\n  %s",
			len(offenders), strings.Join(offenders, "\n  "))
	}
}
