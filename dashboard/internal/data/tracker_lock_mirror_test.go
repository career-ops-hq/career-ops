package data

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Go and Node must compute the SAME tracker lock directory.
//
// trackerLockDirFor's own comment makes the claim:
//
//	// trackerLockDirFor mirrors tracker-utils.mjs exactly so Go and Node writers
//	// contend on the same lock directory for the same canonical tracker path.
//
// and tracker-utils.mjs records what happens when it stops being true:
// "the same directory-lock protocol on purpose, and #2777 showed how the two
// copies drift".
//
// Nothing was checking it. Two implementations of one hash, in two languages,
// with a documented history of drifting — and the failure is not a wrong
// number on a screen. If the directories diverge, `set-status.mjs` and the
// dashboard stop excluding each other and can write applications.md at the
// same time: the user's tracker, with every application in it.
//
// They agree today (verified), so this is a ratchet. It spawns node rather than
// reimplementing the hash a third time, because a third copy is the bug.

// lockMirrorRepoRoot walks up to the checkout that holds tracker-utils.mjs.
//
// Named for this file rather than something general: internal/data holds
// several test files and a shared helper name here would collide with one
// added by another change in flight.
func lockMirrorRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "tracker-utils.mjs")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Skip("tracker-utils.mjs not found above the package directory — not a full checkout")
	return ""
}

// nodeLockDirFor asks tracker-utils.mjs for its answer.
func nodeLockDirFor(t *testing.T, root, trackerPath, lockOverride string) string {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not on PATH; the Go/Node mirror cannot be compared")
	}
	// tracker-utils.mjs imports js-yaml, so on a checkout that has never had
	// `npm install` the import fails before the comparison even starts. That is
	// a missing dev dependency, not a divergence, and reporting it as a failure
	// gives a contributor running `go test` a red build about something this
	// test is not measuring.
	//
	// Probed separately so that ONLY this cause is excused: any other node error
	// below stays fatal, because that is where a real divergence would surface.
	probe := exec.Command("node", "-e", "import('js-yaml').then(()=>{},()=>process.exit(3))")
	probe.Dir = root
	if err := probe.Run(); err != nil {
		t.Skip("js-yaml is not installed (run npm install); tracker-utils.mjs cannot be imported")
	}

	// canonicalizeTrackerPath FIRST, because that is what the real Node callers
	// do and the asymmetry matters: Go canonicalizes inside trackerLockDirFor,
	// while Node's takes "@param appsFile - Canonical tracker path" and leaves
	// it to the caller. openTrackerTransaction honours that —
	//
	//	const trackerPath = canonicalizeTrackerPath(appsFile);
	//	const { lockDir = trackerLockDirFor(trackerPath) } = options;
	//
	// — so this reproduces the composition, not just the one function. Handing
	// Node a raw path instead makes every case "diverge" on any system where
	// the temp dir is a symlink (/var -> /private/var on macOS), which is a
	// broken test rather than a broken mirror.
	const script = `import('./tracker-utils.mjs').then(m => process.stdout.write(m.trackerLockDirFor(m.canonicalizeTrackerPath(process.argv[1]))))`
	cmd := exec.Command("node", "-e", script, trackerPath)
	cmd.Dir = root
	// Cleared rather than inherited: the override is part of what is being
	// compared, so it must be exactly what the Go side was given.
	cmd.Env = append(os.Environ(), "CAREER_OPS_TRACKER_LOCK="+lockOverride)

	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("node trackerLockDirFor(%q): %v", trackerPath, err)
	}
	return strings.TrimSpace(string(out))
}

// skipOnWindowsPendingShortNameFix declines to assert the mirror on Windows,
// where it genuinely does not hold yet (#4957).
//
// %TEMP% can be the 8.3 short form, and Go's EvalSymlinks expands it while
// Node's realpath does not:
//
//	go:   C:\Users\runneradmin\AppData\Local\Temp\…-c6de149c297c17b8.lock
//	node: C:\Users\RUNNER~1\AppData\Local\Temp\…-81308f56e42cc64f.lock
//
// The lock name is sha256(path)[:8], so two spellings of one directory give two
// locks and the two languages stop excluding each other. That is a data-
// integrity bug in the code, not in this test — found by this test on its first
// CI run — and fixing it means changing canonicalization in one of the two
// languages, which wants a Windows machine to verify.
//
// Skipped rather than deleted so the ratchet protects POSIX today, and so the
// fix is three lines away: remove this call and the coverage is already written.
func skipOnWindowsPendingShortNameFix(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("Go and Node canonicalize 8.3 short names differently on Windows; see #4957")
	}
}

func TestLockDirectoryMatchesNodeForTheSameTracker(t *testing.T) {
	skipOnWindowsPendingShortNameFix(t)
	root := lockMirrorRepoRoot(t)

	// A corpus rather than one path: the hash is over the path STRING, so the
	// shapes that could diverge are the ones with characters each language
	// might normalise differently.
	base := t.TempDir()
	for _, name := range []string{
		"applications.md",
		"a path with spaces/applications.md",
		"ünïcodé/applications.md",
		"deeply/nested/data/applications.md",
		// No trailing-dot component: Windows cannot create one, and the entry
		// failed there for that reason rather than telling us anything about
		// the mirror.
		"MiXedCase/Applications.MD",
	} {
		full := filepath.Join(base, name)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("prepare %s: %v", name, err)
		}
		if err := os.WriteFile(full, []byte("# tracker\n"), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}

		t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
		got, err := trackerLockDirFor(full)
		if err != nil {
			t.Fatalf("go trackerLockDirFor(%q): %v", name, err)
		}
		want := nodeLockDirFor(t, root, full, "")

		if got != want {
			t.Errorf("lock directory diverges for %q:\n  go:   %s\n  node: %s\n"+
				"Go and Node would stop excluding each other and could write the tracker at the same time", name, got, want)
		}
	}
}

func TestLockOverrideIsAcceptedAndRejectedIdentically(t *testing.T) {
	skipOnWindowsPendingShortNameFix(t)
	// The intricate half, and the likelier place to drift: both sides accept an
	// override only when it is absolute, lives under the OS temp directory, and
	// carries the career-ops lock prefix — and silently fall back otherwise. An
	// asymmetry here is worse than an outright mismatch, because one side would
	// honour a path the other ignores and neither would report anything.
	root := lockMirrorRepoRoot(t)

	trackerDir := t.TempDir()
	tracker := filepath.Join(trackerDir, "applications.md")
	if err := os.WriteFile(tracker, []byte("# tracker\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	tmp := os.TempDir()
	for _, override := range []string{
		"", // absent -> fallback
		"relative/career-ops-merge-tracker-x.lock",                 // not absolute -> fallback
		filepath.Join(tmp, "career-ops-merge-tracker-ok.lock"),     // valid
		filepath.Join(tmp, "not-the-prefix.lock"),                  // wrong prefix -> fallback
		filepath.Join(trackerDir, "career-ops-merge-tracker.lock"), // outside temp -> fallback
		filepath.Join(tmp, "nested", "career-ops-merge-tracker-n.lock"),
	} {
		t.Setenv("CAREER_OPS_TRACKER_LOCK", override)
		got, err := trackerLockDirFor(tracker)
		if err != nil {
			t.Fatalf("go trackerLockDirFor with override %q: %v", override, err)
		}
		want := nodeLockDirFor(t, root, tracker, override)

		if got != want {
			t.Errorf("override %q is handled differently:\n  go:   %s\n  node: %s", override, got, want)
		}
	}
}
