package main

import (
	"os/exec"
	"regexp"
	"strings"
	"testing"
)

// Every platform variant must still compile.
//
// internal/data splits three times on build tags — tracker_process_*.go,
// tracker_replace_*.go — and `go build` only ever compiles the variant for the
// host. CI runs `go test ./...` on each runner, so the Windows files are
// compiled by exactly one job: the Windows one, which is also the flakiest.
//
// The consequence is quiet. Change the processStatus type, or getProcessStatus's
// signature, on a Mac and everything passes locally and on the ubuntu leg while
// the Windows build is broken — and `go vet` will not tell you either, because
// it type-checks for the host too.
//
// All three targets build today, so this is a ratchet.
//
// Shelling out to `go build` from a test is unusual, but it is the only thing
// that actually answers the question, and it keeps the check inside the
// existing `go test ./...` step rather than adding a workflow one.
// Running it after a change: this test shells out to `go build`, so Go's own
// test cache does not see edits under internal/ as inputs to THIS package's
// test binary. A cached PASS is therefore reused across a mutation, and the
// mutation looks survived when it was never re-run. Use
//
//	go test ./... -count=1
//
// whenever the point is to observe a change here. (Thanks to the review on
// #4968 for catching that this bites anyone trying to verify the guard.)
func TestEveryPlatformVariantCompiles(t *testing.T) {
	if testing.Short() {
		t.Skip("cross-compiling is slower than a unit test; skipped under -short")
	}
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("the go toolchain is not on PATH")
	}

	// The platforms with build-tagged files in this module, plus the two CI
	// runs on. Deliberately not plan9 or js: bubbletea itself does not build
	// for them, so the failure would be upstream's and not actionable here.
	for _, target := range []struct{ goos, goarch string }{
		{"linux", "amd64"},
		{"darwin", "arm64"},
		{"windows", "amd64"},
	} {
		t.Run(target.goos, func(t *testing.T) {
			cmd := exec.Command("go", "build", "./...")
			cmd.Env = append(cmdEnvWithout(cmd, "GOOS", "GOARCH"),
				"GOOS="+target.goos, "GOARCH="+target.goarch)
			out, err := cmd.CombinedOutput()
			if err == nil {
				return
			}

			// A module download failing is the environment; a compile error is the
			// code. The first version skipped on any output containing
			// "go: downloading", which meant a real compile error that happened
			// to follow a download line was skipped instead of reported — the
			// failure this test exists to catch, silently excused.
			//
			// So the compile error is looked for FIRST and wins. Only an output
			// with no compile error in it may be excused as environmental.
			text := string(out)
			switch classifyBuildFailure(text) {
			case failureEnvironment:
				t.Skipf("cannot fetch %s/%s dependencies in this environment: %s",
					target.goos, target.goarch, firstLine(text))
			case failureCompile:
				t.Errorf("GOOS=%s GOARCH=%s does not compile — the %s-only files are not built by any other job:\n%s",
					target.goos, target.goarch, target.goos, text)
			default:
				// Unrecognized: fail rather than skip. An unknown failure that is
				// really environmental costs one red build; an unknown failure
				// that is really a broken cross-build costs the thing this guards.
				t.Errorf("GOOS=%s GOARCH=%s build failed for an unrecognized reason:\n%s",
					target.goos, target.goarch, text)
			}
		})
	}
}

type buildFailureKind int

const (
	failureUnknown buildFailureKind = iota
	failureCompile
	failureEnvironment
)

// classifyBuildFailure decides what a failed `go build` output means.
//
// ONE function rather than two ifs at the call site, so the precedence is
// unit-testable: the case that matters is an output carrying BOTH a module
// download line and a real compile error, which is the normal shape of a first
// cross-build against a cold module cache that is also broken. The first
// version of this file skipped on any output containing "go: downloading",
// which excused exactly the failure this guard exists to catch.
//
// Compile error wins, always.
func classifyBuildFailure(output string) buildFailureKind {
	if goDiagnosticRe.MatchString(output) {
		return failureCompile
	}
	for _, marker := range []string{
		"go: downloading", "dial tcp", "connection refused",
		"certificate", "proxyconnect", "i/o timeout", "no such host",
		"module lookup disabled", "unrecognized import path",
	} {
		if strings.Contains(output, marker) {
			return failureEnvironment
		}
	}
	return failureUnknown
}

// Every Go diagnostic carries the file:line:column form
// ("internal/data/x.go:14:9: undefined: processAlive"), which is both the most
// reliable marker and independent of the message wording.
var goDiagnosticRe = regexp.MustCompile(`\.go:\d+:\d+:`)

// cmdEnvWithout returns the process environment with the named variables
// dropped, so the caller's own GOOS/GOARCH cannot leak into the child.
func cmdEnvWithout(cmd *exec.Cmd, names ...string) []string {
	base := cmd.Environ()
	kept := make([]string, 0, len(base))
	for _, kv := range base {
		drop := false
		for _, name := range names {
			if strings.HasPrefix(kv, name+"=") {
				drop = true
				break
			}
		}
		if !drop {
			kept = append(kept, kv)
		}
	}
	return kept
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// The classification is unit-tested because the case that matters is hard to
// produce on demand: a build whose output carries BOTH a module download line
// and a real compile error. The first version of this file skipped on that,
// excusing exactly the failure the guard exists to catch.
func TestBuildFailureClassification(t *testing.T) {
	const downloadLine = "go: downloading github.com/charmbracelet/x/ansi v0.11.8\n"
	const diagnostic = "internal/data/tracker_process_windows.go:14:9: undefined: processAlive\n"

	for _, tc := range []struct {
		name   string
		output string
		want   buildFailureKind
	}{
		{"a compile error alone", "# .../internal/data\n" + diagnostic, failureCompile},
		{"a download failure alone", downloadLine + "dial tcp 1.2.3.4:443: connect: connection refused\n", failureEnvironment},
		// THE CASE: both present, and the compile error must win.
		{"both, the compile error wins", downloadLine + "# .../internal/data\n" + diagnostic, failureCompile},
		{"neither — an unrecognized failure must not be excused", "go: some future error nobody has seen\n", failureUnknown},
		{"empty output", "", failureUnknown},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyBuildFailure(tc.output); got != tc.want {
				t.Errorf("classifyBuildFailure = %v, want %v", got, tc.want)
			}
		})
	}
}
