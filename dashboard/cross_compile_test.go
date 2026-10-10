package main

import (
	"os/exec"
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

			// A module download failing is the environment, not the code. Told
			// apart rather than blanket-skipped, so a real compile error still
			// fails — the same reason the js-yaml probe in
			// internal/data/tracker_lock_mirror_test.go is narrow.
			text := string(out)
			for _, networkish := range []string{
				"go: downloading", "dial tcp", "connection refused",
				"certificate", "proxyconnect", "i/o timeout", "no such host",
			} {
				if strings.Contains(text, networkish) {
					t.Skipf("cannot fetch %s/%s dependencies in this environment: %s",
						target.goos, target.goarch, firstLine(text))
				}
			}
			t.Errorf("GOOS=%s GOARCH=%s does not compile — the %s-only files are not built by any other job:\n%s",
				target.goos, target.goarch, target.goos, text)
		})
	}
}

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
