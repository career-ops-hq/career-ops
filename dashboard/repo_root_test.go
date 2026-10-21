package main

import (
	"os"
	"path/filepath"
	"testing"
)

// A relative data root must name the same directory wherever the dashboard
// was started.
//
// resolveEnvPath used to join against a search that looked at cwd and cwd's
// PARENT only, then silently fell back to cwd — so from anywhere deeper a
// relative CAREER_OPS_ROOT anchored somewhere else than the .mjs scripts use,
// and the dashboard read a different tracker than every writer. It now defers
// to data.FindRepoRoot, the same walker a relative CAREER_OPS_TRACKER goes
// through.

func markedCheckout(t *testing.T, depth int) (root, deepest string) {
	t.Helper()
	root = t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "path-resolver.mjs"), []byte("// marker\n"), 0o644); err != nil {
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

func TestRelativePathAnchorsToTheCheckoutNotTheWorkingDirectory(t *testing.T) {
	root, deepest := markedCheckout(t, 3)

	chdirForTest(t, root)
	fromRoot := resolveEnvPath("mydata")

	chdirForTest(t, deepest)
	fromDeep := resolveEnvPath("mydata")

	if fromRoot != fromDeep {
		t.Errorf("a relative data root moved with the working directory:\n  from checkout root: %s\n  from 3 levels down: %s", fromRoot, fromDeep)
	}
	if !sameResolvedDir(filepath.Dir(fromDeep), root) {
		t.Errorf("relative path anchored to %s; want it under the checkout %s", filepath.Dir(fromDeep), root)
	}
}

func TestAbsolutePathIsUntouched(t *testing.T) {
	// Guards the fix rather than the bug: an absolute override must never be
	// re-anchored, and must not require a findable checkout at all.
	_, deepest := markedCheckout(t, 2)
	chdirForTest(t, deepest)

	abs := filepath.Join(t.TempDir(), "elsewhere")
	if got := resolveEnvPath(abs); got != filepath.Clean(abs) {
		t.Errorf("resolveEnvPath(%q) = %q; an absolute path must pass through", abs, got)
	}
}

func TestEmptyOverrideStaysEmpty(t *testing.T) {
	// main() distinguishes "" from a resolved path to decide whether the
	// override was set at all, so whitespace must not become a real path.
	for _, in := range []string{"", "   ", "\t"} {
		if got := resolveEnvPath(in); got != "" {
			t.Errorf("resolveEnvPath(%q) = %q; want empty so main() can tell the override was unset", in, got)
		}
	}
}
