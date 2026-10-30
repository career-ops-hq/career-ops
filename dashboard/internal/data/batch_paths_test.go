package data

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// batch/batch-runner.sh keeps batch-input.tsv and batch-state.tsv beside
// itself in the checkout, even when CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR / a
// .career-ops-data marker put the data root somewhere else (#5115, #5116). The
// dashboard's batch-based job URL fallbacks must read them from there, not
// from the data root, or those rows lose their posting link.

const batchInputFixture = "id\turl\tsource\tnotes\n" +
	"7\thttps://jobs.example.com/listing/7\tmanual\tPlatform Engineer @ Acme | 90% | https://jobs.example.com/acme-platform\n" +
	"8\thttps://jobs.example.com/listing/8\tmanual\tData Engineer @ Globex | 85% | https://jobs.example.com/globex-data\n" +
	"9\thttps://jobs.example.com/listing/9\tmanual\tSite Reliability Engineer @ Initech | 80% | https://jobs.example.com/initech-sre\n"

const batchStateFixture = "id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n" +
	"8\thttps://jobs.example.com/listing/8\tcompleted\t2026-08-01T00:00:00Z\t2026-08-01T00:10:00Z\t002\t4.1\t-\t0\n"

// Rows 1 and 2 use company names that do not match batch-input.tsv, so only
// the Batch ID tier and the report-number tier can give them a URL. Row 3 has
// no report, so only the company-name tier can.
const batchTrackerFixture = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-08-01 | Acme Robotics | Platform Engineer | 4.0/5 | Evaluated | — | [001](../reports/001-acme.md) | batch id tier |
| 2 | 2026-08-01 | Globex Labs | Data Engineer | 4.1/5 | Evaluated | — | [002](../reports/002-globex.md) | report number tier |
| 3 | 2026-08-01 | Initech | Site Reliability Engineer | 3.8/5 | Evaluated | — | — | company name tier |
`

func writeTestFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// writeBatchDataRoot writes the user layer: tracker and reports, no batch/.
func writeBatchDataRoot(t *testing.T, root string) {
	t.Helper()
	writeTestFile(t, filepath.Join(root, "data", "applications.md"), batchTrackerFixture)
	writeTestFile(t, filepath.Join(root, "reports", "001-acme.md"), "# Evaluation: Acme — Platform Engineer\n\n**Batch ID:** 7\n")
	writeTestFile(t, filepath.Join(root, "reports", "002-globex.md"), "# Evaluation: Globex — Data Engineer\n\n**Date:** 2026-08-01\n")
}

// writeBatchCheckout writes the repo-root marker and the runner's batch files.
func writeBatchCheckout(t *testing.T, root string) {
	t.Helper()
	writeTestFile(t, filepath.Join(root, repoRootMarker), "// marker\n")
	writeTestFile(t, filepath.Join(root, "batch", "batch-input.tsv"), batchInputFixture)
	writeTestFile(t, filepath.Join(root, "batch", "batch-state.tsv"), batchStateFixture)
}

func assertBatchTierURLs(t *testing.T, dataRoot string) {
	t.Helper()
	apps := mustParseApplications(t, dataRoot)
	if len(apps) != 3 {
		t.Fatalf("expected 3 applications, got %d", len(apps))
	}
	want := []struct{ tier, url string }{
		{"Batch ID -> batch-input.tsv", "https://jobs.example.com/acme-platform"},
		{"report number -> batch-state.tsv", "https://jobs.example.com/globex-data"},
		{"company name -> batch-input.tsv", "https://jobs.example.com/initech-sre"},
	}
	for i, w := range want {
		if got := apps[i].JobURL; got != w.url {
			t.Errorf("row %d (%s): JobURL = %q, want %q", i+1, w.tier, got, w.url)
		}
	}
}

func TestParseApplicationsReadsBatchFilesFromTheCheckout(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")

	checkout := t.TempDir()
	writeBatchCheckout(t, checkout)
	dataRoot := t.TempDir()
	writeBatchDataRoot(t, dataRoot)
	chdirForTest(t, checkout)

	if _, err := os.Stat(filepath.Join(dataRoot, "batch")); !os.IsNotExist(err) {
		t.Fatalf("the data root must have no batch/ directory for this test, stat err = %v", err)
	}
	assertBatchTierURLs(t, dataRoot)
}

// writeStaleBatchDataRoot gives the data root its own batch files, whose URLs
// differ from the checkout's, so a test can tell which copy was read.
func writeStaleBatchDataRoot(t *testing.T, root string) {
	t.Helper()
	stale := func(s string) string { return strings.ReplaceAll(s, "jobs.example.com", "stale.example.com") }
	writeTestFile(t, filepath.Join(root, "batch", "batch-input.tsv"), stale(batchInputFixture))
	writeTestFile(t, filepath.Join(root, "batch", "batch-state.tsv"), stale(batchStateFixture))
}

func TestParseApplicationsPrefersCheckoutBatchFilesOverDataRootCopies(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")

	checkout := t.TempDir()
	writeBatchCheckout(t, checkout)
	dataRoot := t.TempDir()
	writeBatchDataRoot(t, dataRoot)
	writeStaleBatchDataRoot(t, dataRoot)
	chdirForTest(t, checkout)

	assertBatchTierURLs(t, dataRoot)
}

func TestParseApplicationsDoesNotFallBackWhenTheCheckoutBatchFileIsUnreadable(t *testing.T) {
	// Only a missing checkout file falls back. Any other stat error must not
	// swap in the data root's older copy.
	if runtime.GOOS == "windows" {
		t.Skip("directory permissions do not block stat on Windows")
	}
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	t.Setenv("CAREER_OPS_TRACKER", "")

	checkout := t.TempDir()
	writeBatchCheckout(t, checkout)
	dataRoot := t.TempDir()
	writeBatchDataRoot(t, dataRoot)
	writeStaleBatchDataRoot(t, dataRoot)
	chdirForTest(t, checkout)

	batchDir := filepath.Join(checkout, "batch")
	if err := os.Chmod(batchDir, 0o000); err != nil {
		t.Fatalf("chmod checkout batch/: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(batchDir, 0o755) })

	for i, app := range mustParseApplications(t, dataRoot) {
		if strings.Contains(app.JobURL, "stale.example.com") {
			t.Errorf("row %d: JobURL = %q came from the data root's copy", i+1, app.JobURL)
		}
	}
}

func TestParseApplicationsReadsBatchFilesInTheDefaultLayout(t *testing.T) {
	// Control: with the data root and the checkout the same directory, nothing moves.
	t.Setenv("CAREER_OPS_TRACKER", "")

	root := t.TempDir()
	writeBatchCheckout(t, root)
	writeBatchDataRoot(t, root)
	chdirForTest(t, root)

	assertBatchTierURLs(t, root)
}

func TestParseApplicationsFallsBackToDataRootBatchFilesWithoutACheckout(t *testing.T) {
	// No checkout can be found from cwd: the data root's batch/ is read, as before.
	t.Setenv("CAREER_OPS_TRACKER", "")

	dataRoot := t.TempDir()
	writeBatchDataRoot(t, dataRoot)
	writeTestFile(t, filepath.Join(dataRoot, "batch", "batch-input.tsv"), batchInputFixture)
	writeTestFile(t, filepath.Join(dataRoot, "batch", "batch-state.tsv"), batchStateFixture)
	chdirForTest(t, t.TempDir())

	if root, err := FindRepoRoot(); err != nil || root != "" {
		t.Skipf("a checkout was found via the executable (%q, %v); this case needs none", root, err)
	}
	assertBatchTierURLs(t, dataRoot)
}

func TestParseApplicationsFallsBackToDataRootBatchFilesTheCheckoutLacks(t *testing.T) {
	// A checkout with no batch files of its own must not hide the data root's.
	t.Setenv("CAREER_OPS_TRACKER", "")

	checkout := t.TempDir()
	writeTestFile(t, filepath.Join(checkout, repoRootMarker), "// marker\n")
	if err := os.MkdirAll(filepath.Join(checkout, "batch"), 0o755); err != nil {
		t.Fatalf("mkdir checkout batch: %v", err)
	}
	dataRoot := t.TempDir()
	writeBatchDataRoot(t, dataRoot)
	writeTestFile(t, filepath.Join(dataRoot, "batch", "batch-input.tsv"), batchInputFixture)
	writeTestFile(t, filepath.Join(dataRoot, "batch", "batch-state.tsv"), batchStateFixture)
	chdirForTest(t, checkout)

	assertBatchTierURLs(t, dataRoot)
}
