package data

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// A tracker that cannot be read is not a tracker that is not there.
//
// ParseApplications folded every read failure into a nil slice, so an
// applications.md that exists and cannot be opened was indistinguishable from a
// first run. That reached two callers and each got it wrong in its own way:
// startup printed "could not find applications.md" about a file sitting right
// there, and a reload rebuilt the pipeline from nil — emptying the screen and
// dropping every rate to 0%, which renders red.
//
// EISDIR is the failure used here (a directory where the file belongs) because
// it reproduces as a non-root user on every platform this suite runs on, unlike
// a chmod-based permission denial.

/** A data root whose tracker path is a directory, so the read fails. */
func brokenTrackerRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "data", "applications.md"), 0o755); err != nil {
		t.Fatalf("prepare broken tracker: %v", err)
	}
	return root
}

func TestParseApplicationsReportsAnUnreadableTracker(t *testing.T) {
	apps, err := ParseApplications(brokenTrackerRoot(t))
	if err == nil {
		t.Fatal("an unreadable tracker must report an error, not an empty pipeline")
	}
	if apps != nil {
		t.Fatalf("expected no applications alongside the error, got %d", len(apps))
	}
	// The path belongs in the message: the user has to know WHICH file, and the
	// tracker location is configurable, so naming it is not redundant.
	if !strings.Contains(err.Error(), "applications.md") {
		t.Errorf("error should name the file it could not read, got %q", err)
	}
	// Callers branch on this to keep the first-run wording for an absent file,
	// so it must NOT look like a missing file.
	if errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a present-but-unreadable tracker must not report as ErrNotExist: %v", err)
	}
}

func TestParseApplicationsReportsAnAbsentTrackerAsNotExist(t *testing.T) {
	// The other half of the distinction, and the reason the error is not just a
	// boolean: startup keeps its original "could not find" wording for this one.
	apps, err := ParseApplications(t.TempDir())
	if err == nil {
		t.Fatal("an absent tracker must still report an error — the dashboard exits on it")
	}
	if !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("an absent tracker must unwrap to fs.ErrNotExist so callers can tell it apart, got %v", err)
	}
	if apps != nil {
		t.Fatalf("expected no applications, got %d", len(apps))
	}
}

func TestParseApplicationsKeepsAnEmptyTrackerSucceeding(t *testing.T) {
	// Exactly what onboarding tells a new user to create: header, no rows. This
	// must stay a SUCCESS with zero applications — not an error, and not nil —
	// or the dashboard refuses to start for everyone on their first day.
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	header := "# Applications Tracker\n\n" +
		"| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n" +
		"|---|------|---------|------|-------|--------|-----|--------|-------|\n"
	if err := os.WriteFile(filepath.Join(root, "data", "applications.md"), []byte(header), 0o644); err != nil {
		t.Fatal(err)
	}

	apps, err := ParseApplications(root)
	if err != nil {
		t.Fatalf("an empty tracker is a valid tracker: %v", err)
	}
	if apps == nil {
		t.Fatal("an empty tracker must return a non-nil empty slice — main() exits when apps is nil")
	}
	if len(apps) != 0 {
		t.Fatalf("expected no rows, got %d", len(apps))
	}
}

func TestBrokenTrackerDoesNotReportTheSearchAsFailing(t *testing.T) {
	// Why the error matters beyond the message. Before this, a reload after the
	// tracker broke rebuilt the pipeline from nil, and these rates came back as
	// three zeroes — which progress.go colours with rateColor, whose default
	// branch is Red. The user saw an empty pipeline and a search failing on
	// every metric because a file could not be opened.
	//
	// The guarantee asserted is the one callers rely on: the read reports
	// failure, so there is something to branch on instead of a zeroed metric
	// set that is indistinguishable from a real one.
	apps, err := ParseApplications(brokenTrackerRoot(t))
	if err == nil {
		t.Fatal("expected the read to fail")
	}

	metrics := ComputeProgressMetrics(apps, nil)
	if metrics.ResponseRate != 0 || metrics.InterviewRate != 0 || metrics.OfferRate != 0 {
		t.Fatalf("sanity: metrics from a failed read should be zeroed, got %+v", metrics)
	}
	// Documents the consequence rather than asserting a colour: these zeroes are
	// not measurements, and the caller must not present them as any.
	t.Logf("metrics computed from a failed read are indistinguishable from a real 0%%: "+
		"response=%.1f interview=%.1f offer=%.1f — which is why the error is returned",
		metrics.ResponseRate, metrics.InterviewRate, metrics.OfferRate)
}

func TestAnInaccessibleTrackerIsNotReportedAsMissing(t *testing.T) {
	// One step earlier than the tests above. resolveTrackerPath fell back to the
	// legacy ./applications.md on ANY stat failure, not just absence — so when
	// data/applications.md existed but could not be examined, the reader was
	// sent to a legacy path that does not exist, got ENOENT from there, and
	// startup printed "could not find applications.md" about a permission
	// problem on a file sitting right where it belongs.
	if runtime.GOOS == "windows" {
		t.Skip("directory permissions do not produce EACCES on Windows")
	}
	if os.Geteuid() == 0 {
		t.Skip("running as root; permission bits do not deny access")
	}

	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	tracker := filepath.Join(dataDir, "applications.md")
	if err := os.WriteFile(tracker, []byte("# Applications Tracker\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Deny traversal of data/, so stat of the tracker inside it fails with
	// something that is NOT ErrNotExist while the file is demonstrably there.
	if err := os.Chmod(dataDir, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dataDir, 0o755) })

	if got := resolveTrackerPath(root); got != filepath.Clean(tracker) {
		t.Errorf("resolveTrackerPath = %s; want the canonical tracker %s, not the legacy fallback", got, tracker)
	}

	_, err := ParseApplications(root)
	if err == nil {
		t.Fatal("expected an error for a tracker that cannot be read")
	}
	if errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a tracker that EXISTS but cannot be accessed must not report as missing: %v", err)
	}
	// The message has to name the real file, or the user goes looking in the
	// wrong place — which is what the legacy fallback caused.
	if !strings.Contains(err.Error(), filepath.Join("data", "applications.md")) {
		t.Errorf("the error should name data/applications.md, got %q", err)
	}
}
