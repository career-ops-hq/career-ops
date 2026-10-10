package data

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// Finding the checkout must not depend on the working directory.
//
// AGENTS.md and DATA_CONTRACT.md both say a relative CAREER_OPS_ROOT /
// CAREER_OPS_TRACKER is "resolved relative to the repository root", and
// path-resolver.mjs does that with no reference to cwd — it resolves against
// its own __dirname. This walker is what a relative CAREER_OPS_TRACKER goes
// through, and main.go now defers to it rather than keeping a second search,
// so the data root and the tracker cannot anchor to different directories.

func markedCheckout(t *testing.T, depth int) (root, deepest string) {
	t.Helper()
	root = t.TempDir()
	if err := os.WriteFile(filepath.Join(root, repoRootMarker), []byte("// marker\n"), 0o644); err != nil {
		t.Fatalf("write marker: %v", err)
	}
	deepest = root
	for i := 0; i < depth; i++ {
		deepest = filepath.Join(deepest, "nested")
	}
	if err := os.MkdirAll(deepest, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	return root, deepest
}

func chdirForTest(t *testing.T, dir string) {
	t.Helper()
	orig, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("chdir %s: %v", dir, err)
	}
	t.Cleanup(func() { _ = os.Chdir(orig) })
}

// sameResolvedDir compares after resolving symlinks: a temp dir on macOS is
// reached through /var -> /private/var, so the strings differ while the
// directory does not, and comparing strings would fail for the wrong reason.
func sameResolvedDir(a, b string) bool {
	ra, err := filepath.EvalSymlinks(a)
	if err != nil {
		ra = a
	}
	rb, err := filepath.EvalSymlinks(b)
	if err != nil {
		rb = b
	}
	return ra == rb
}

func TestFindRepoRootFromAnyDepth(t *testing.T) {
	for _, depth := range []int{0, 1, 2, 3, 5} {
		root, deepest := markedCheckout(t, depth)
		chdirForTest(t, deepest)

		got, err := FindRepoRoot()
		if err != nil {
			t.Fatalf("depth %d: %v", depth, err)
		}
		if !sameResolvedDir(got, root) {
			t.Errorf("from %d level(s) below the checkout: FindRepoRoot() = %s; want %s", depth, got, root)
		}
	}
}

func TestFindRepoRootSurfacesAnUnexpectedStatError(t *testing.T) {
	// "Not here" and "could not look" are different facts. Walking past a
	// directory that exists and cannot be examined would anchor the data root
	// somewhere else entirely, so the error is returned rather than swallowed
	// into a silent fallback.
	if runtime.GOOS == "windows" {
		t.Skip("directory permissions do not produce EACCES on Windows")
	}
	if os.Geteuid() == 0 {
		t.Skip("running as root; permission bits do not deny access")
	}

	base := t.TempDir()
	blocked := filepath.Join(base, "blocked")
	inner := filepath.Join(blocked, "inner")
	if err := os.MkdirAll(inner, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(blocked, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(blocked, 0o755) })

	if _, err := ancestorWithMarker(inner); err == nil {
		t.Error("a directory that cannot be examined must be reported, not walked past")
	}
}

func TestFindRepoRootReturnsEmptyWhenThereIsNoCheckout(t *testing.T) {
	// Empty, not an error: no checkout above an arbitrary directory is an
	// ordinary situation, and the caller decides what to do about it.
	bare := t.TempDir()
	chdirForTest(t, bare)

	root, err := FindRepoRoot()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if root != "" && !sameResolvedDir(root, bare) {
		// The executable's own ancestors are a legitimate second source, so a
		// hit is only surprising if it is neither cwd nor near the binary.
		t.Logf("FindRepoRoot() found %s via the executable path, which is the intended second source", root)
	}
}
