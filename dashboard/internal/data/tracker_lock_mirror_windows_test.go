//go:build windows

package data

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// shortPathName asks Windows for the 8.3 alias of an existing path. It returns
// the path unchanged when the volume does not generate short names, which is
// a per-volume setting.
func shortPathName(t *testing.T, path string) string {
	t.Helper()
	long, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]uint16, syscall.MAX_PATH)
	n, err := syscall.GetShortPathName(long, &buf[0], uint32(len(buf)))
	if err != nil {
		t.Fatalf("GetShortPathName(%q): %v", path, err)
	}
	return syscall.UTF16ToString(buf[:n])
}

func TestLockDirectoryMatchesNodeThroughAShortName(t *testing.T) {
	// The other mirror tests meet an 8.3 name only when %TEMP% happens to be
	// one, as on the GitHub runner (C:\Users\RUNNER~1\...). This one makes a
	// directory whose name has an alias and hands both languages the alias, so
	// the case is covered on any Windows volume that generates short names
	// (#4957).
	root := lockMirrorRepoRoot(t)
	dir := filepath.Join(t.TempDir(), "a directory name long enough for an alias")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	tracker := filepath.Join(dir, "applications.md")
	if err := os.WriteFile(tracker, []byte("# tracker\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	short := shortPathName(t, tracker)
	if short == tracker {
		t.Skip("this volume does not generate 8.3 names")
	}

	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	got, err := trackerLockDirFor(short)
	if err != nil {
		t.Fatalf("go trackerLockDirFor(%q): %v", short, err)
	}
	want := nodeLockDirFor(t, root, short, "")
	if got != want {
		t.Errorf("lock directory diverges for the short name %q:\n  go:   %s\n  node: %s", short, got, want)
	}
	long, err := trackerLockDirFor(tracker)
	if err != nil {
		t.Fatal(err)
	}
	if long != got {
		t.Errorf("Go gives the short and long spellings different locks:\n  long:  %s\n  short: %s", long, got)
	}
}
