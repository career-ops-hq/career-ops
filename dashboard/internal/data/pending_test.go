package data

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The Inbox tab (#5269) lists the unchecked rows of the Pending section of
// data/pipeline.md, read in Go with the row grammar of the web inbox's
// parseInbox (web/src/lib/pipeline-table.mjs), and labels each one with what
// batch-input.tsv and batch-state.tsv record for it. Nothing is written.

func onlyRow(t *testing.T, text string) PendingRow {
	t.Helper()
	rows := ParsePendingRows(text)
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1: %#v", len(rows), rows)
	}
	return rows[0]
}

func TestPendingRowReadsRankReasonAndLocation(t *testing.T) {
	row := onlyRow(t, "## Pending\n\n- [ ] https://jobs.example.com/1 | Acme | PM | Remote | rank: 4.2/5 — strong fit\n")
	if row.URL != "https://jobs.example.com/1" || row.Company != "Acme" || row.Role != "PM" || row.Location != "Remote" {
		t.Fatalf("row = %#v", row)
	}
	if !row.HasRank || row.Rank != 4.2 || row.RankReason != "strong fit" {
		t.Fatalf("rank = %v %v %q, want 4.2 \"strong fit\"", row.HasRank, row.Rank, row.RankReason)
	}
}

func TestPendingRowReadsPostedWithoutLocation(t *testing.T) {
	row := onlyRow(t, "## Pending\n- [ ] https://jobs.example.com/2 | Acme | PM | posted: 2026-10-01\n")
	if row.Location != "" {
		t.Fatalf("location = %q, want empty", row.Location)
	}
	if row.Posted != "2026-10-01" {
		t.Fatalf("posted = %q, want 2026-10-01", row.Posted)
	}
}

func TestPendingRowIgnoresAnUnknownLabel(t *testing.T) {
	row := onlyRow(t, "## Pending\n- [ ] https://jobs.example.com/3 | Acme | PM | Remote | decision: maybe | posted: 2026-10-02\n")
	if row.Location != "Remote" || row.Posted != "2026-10-02" || row.HasRank {
		t.Fatalf("row = %#v, want location Remote, posted 2026-10-02 and no rank", row)
	}
}

func TestPendingRowListsALocalTarget(t *testing.T) {
	row := onlyRow(t, "## Pending\n- [ ] local:jds/acme.md | Acme | PM\n")
	if row.URL != "local:jds/acme.md" {
		t.Fatalf("url = %q", row.URL)
	}
}

func TestPendingRowsSkipCheckedFlaggedAndProcessedRows(t *testing.T) {
	text := strings.Join([]string{
		"# Pipeline",
		"## Pending",
		"- [x] https://jobs.example.com/done | Acme | Done",
		"- [X] https://jobs.example.com/done2 | Acme | Done too",
		"- [!] https://jobs.example.com/flagged | Acme | Flagged",
		"- [ ] https://jobs.example.com/keep | Acme | Keep",
		"## Processed",
		"- [ ] https://jobs.example.com/processed | Acme | Processed but unchecked",
	}, "\n")
	rows := ParsePendingRows(text)
	if len(rows) != 1 || rows[0].Role != "Keep" {
		t.Fatalf("rows = %#v, want only Keep", rows)
	}
}

func TestPendingRowsReadEveryLanguageHeading(t *testing.T) {
	for _, pair := range pendingSectionPairs {
		t.Run(pair[0], func(t *testing.T) {
			text := "## " + pair[0] + "\n- [ ] https://jobs.example.com/1 | Acme | PM\n## " + pair[1] + "\n- [ ] https://jobs.example.com/2 | Acme | Old\n"
			rows := ParsePendingRows(text)
			if len(rows) != 1 || rows[0].Role != "PM" {
				t.Fatalf("rows = %#v, want only PM", rows)
			}
		})
	}
	// Accents and case are folded, as lib/pipeline-sections.mjs folds them: a
	// hand-typed "Traitées" closes the French Pending section, and the Pending
	// heading may be written in lower case or decomposed form.
	for _, heading := range []string{"## pendientes", "##   Offen  ", "## İşlenenler", "## Oczekujące", "## Oczekuja\u0328ce"} {
		if sectionKind(heading) == "" {
			t.Errorf("sectionKind(%q) found no section", heading)
		}
	}
	if got := sectionKind("## Traitées"); got != "processed" {
		t.Errorf("sectionKind(## Traitées) = %q, want processed", got)
	}
	for _, line := range []string{"# Pending", "### Pending", "## Something else", "Pending"} {
		if got := sectionKind(line); got != "" {
			t.Errorf("sectionKind(%q) = %q, want none", line, got)
		}
	}
}

func TestPendingSectionEndsAtTheNextHeading(t *testing.T) {
	text := "## Pending\n- [ ] https://jobs.example.com/1 | Acme | PM\n## Notes\n- [ ] https://jobs.example.com/2 | Acme | Not pending\n"
	rows := ParsePendingRows(text)
	if len(rows) != 1 || rows[0].Role != "PM" {
		t.Fatalf("rows = %#v, want only PM", rows)
	}
	if rows := ParsePendingRows("- [ ] https://jobs.example.com/1 | Acme | PM\n"); len(rows) != 0 {
		t.Fatalf("a file with no Pending heading listed %#v", rows)
	}
}

func TestPendingRowsReadCRLF(t *testing.T) {
	rows := ParsePendingRows("## Pending\r\n- [ ] https://jobs.example.com/1 | Acme | PM | Remote\r\n- [ ] https://jobs.example.com/2 | Acme | PO\r\n")
	if len(rows) != 2 || rows[0].Location != "Remote" || rows[1].Role != "PO" {
		t.Fatalf("rows = %#v", rows)
	}
}

func TestPendingRowsListOneRowPerURL(t *testing.T) {
	rows := ParsePendingRows("## Pending\n- [ ] https://jobs.example.com/1 | Acme | First\n- [ ] https://Jobs.Example.com/1 | Acme | Repeat\n- [ ] https://jobs.example.com/2 | Acme | Second\n")
	if len(rows) != 2 || rows[0].Role != "First" || rows[1].Role != "Second" {
		t.Fatalf("rows = %#v, want First and Second", rows)
	}
}

func TestPendingRowWithAnOutOfRangeOrUnreadableRankIsUnranked(t *testing.T) {
	for _, stamp := range []string{"rank: 9/5 — too high", "rank: 5.5/5 — just over", "rank: high — no number", "rank: 4.2/5"} {
		row := onlyRow(t, "## Pending\n- [ ] https://jobs.example.com/1 | Acme | PM | Remote | "+stamp+"\n")
		if row.HasRank {
			t.Errorf("%q read as rank %v", stamp, row.Rank)
		}
	}
	row := onlyRow(t, "## Pending\n- [ ] https://jobs.example.com/1 | Acme | PM | Remote | rank: 5/5 - top\n")
	if !row.HasRank || row.Rank != 5 || row.RankReason != "top" {
		t.Fatalf("rank: 5/5 - top read as %#v", row)
	}
}

func TestPendingRowTextIsSanitized(t *testing.T) {
	row := onlyRow(t, "## Pending\n- [ ] https://jobs.example.com/1 | Ac\x1b[2Jme | P\x1bM | Re\x07mote | rank: 4/5 — fi\x1b]8;;x\x1b\\t\n")
	for _, s := range []string{row.URL, row.Company, row.Role, row.Location, row.RankReason} {
		if strings.ContainsRune(s, 0x1b) || strings.ContainsRune(s, 0x07) {
			t.Fatalf("control byte survived in %q", s)
		}
	}
}

// writePending writes data/pipeline.md under root.
func writePending(t *testing.T, root, body string) {
	t.Helper()
	writeTestFile(t, filepath.Join(root, "data", "pipeline.md"), body)
}

func TestLoadPendingRowsMissingFileIsEmpty(t *testing.T) {
	chdirForTest(t, t.TempDir())
	rows, err := LoadPendingRows(t.TempDir())
	if err != nil || len(rows) != 0 {
		t.Fatalf("rows, err = %#v, %v; want none and no error", rows, err)
	}
}

func TestLoadPendingRowsReportsAnUnreadableFile(t *testing.T) {
	root := t.TempDir()
	chdirForTest(t, t.TempDir())
	// A directory where the file should be: os.ReadFile fails, and not with
	// ErrNotExist, on every platform.
	if err := os.MkdirAll(filepath.Join(root, "data", "pipeline.md"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadPendingRows(root); err == nil || errors.Is(err, os.ErrNotExist) {
		t.Fatalf("err = %v, want a read error that is not ErrNotExist", err)
	}
}

const statusPipeline = `## Pending
- [ ] https://jobs.example.com/none | Acme | Not queued
- [ ] https://jobs.example.com/queued | Acme | Queued
- [ ] https://jobs.example.com/rate | Acme | Rate limited
- [ ] https://jobs.example.com/unknown | Acme | Unknown state
- [ ] https://jobs.example.com/running | Acme | Running
- [ ] https://jobs.example.com/paused | Acme | Paused
- [ ] https://jobs.example.com/question | Acme | Needs answer
- [ ] https://jobs.example.com/failed | Acme | Failed
- [ ] https://jobs.example.com/completed | Acme | Completed
- [ ] https://jobs.example.com/skipped | Acme | Skipped
- [ ] https://jobs.example.com/retried | Acme | Retried
- [ ] https://Jobs.Example.com | Acme | Spelled differently
`

const statusInput = "# batch-input.tsv — generated by sync-batch-input.mjs\n# id<tab>url<tab>source<tab>notes\n" +
	"1\thttps://jobs.example.com/queued\tpipeline\tQueued\n" +
	"2\thttps://jobs.example.com/rate\tpipeline\tRate limited\n" +
	"3\thttps://jobs.example.com/retried\tpipeline\tFirst try\n" +
	"4\thttps://jobs.example.com/unknown\tpipeline\tUnknown\n" +
	"5\thttps://jobs.example.com/running\tpipeline\tRunning\n" +
	"6\thttps://jobs.example.com/paused\tpipeline\tPaused\n" +
	"7\thttps://jobs.example.com/question\tpipeline\tQuestion\n" +
	"8\thttps://jobs.example.com/failed\tpipeline\tFailed\n" +
	"9\thttps://jobs.example.com/retried\tpipeline\tSecond try\n" +
	"10\thttps://jobs.example.com/completed\tpipeline\tCompleted\n" +
	"11\thttps://jobs.example.com/skipped\tpipeline\tSkipped\n" +
	"12\thttps://jobs.example.com/\tpipeline\tSpelled differently\n"

const statusState = "id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n" +
	"2\thttps://jobs.example.com/rate\trate_limited\t-\t-\t-\t-\t-\t1\n" +
	"3\thttps://jobs.example.com/retried\tfailed\t-\t-\t-\t-\tboom\t1\n" +
	"4\thttps://jobs.example.com/unknown\tsomething_new\t-\t-\t-\t-\t-\t0\n" +
	"5\thttps://jobs.example.com/running\tprocessing\t-\t-\t-\t-\t-\t0\n" +
	"6\thttps://jobs.example.com/paused\tpaused_rate_limit\t-\t-\t-\t-\t-\t0\n" +
	"7\thttps://jobs.example.com/question\tneeds_confirmation\t-\t-\t-\t-\tWhich?\t0\n" +
	"8\thttps://jobs.example.com/failed\tfailed\t-\t-\t-\t-\tboom\t2\n" +
	"10\thttps://jobs.example.com/completed\tcompleted\t-\t-\t012\t4.1\t-\t0\n" +
	"11\thttps://jobs.example.com/skipped\tskipped\t-\t-\t-\t-\tclosed\t0\n" +
	"12\thttps://jobs.example.com/\tprocessing\t-\t-\t-\t-\t-\t0\n"

func statusByRole(rows []PendingRow) map[string]string {
	out := map[string]string{}
	for _, row := range rows {
		out[row.Role] = row.Status
	}
	return out
}

func TestLoadPendingRowsReadsEachBatchStatus(t *testing.T) {
	root := t.TempDir()
	writeBatchCheckoutFiles(t, root, statusInput, statusState)
	writePending(t, root, statusPipeline)
	chdirForTest(t, root)

	rows, err := LoadPendingRows(root)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"Not queued":          PendingStatusNone,
		"Queued":              PendingStatusQueued,
		"Rate limited":        PendingStatusQueued,
		"Unknown state":       PendingStatusQueued,
		"Running":             PendingStatusRunning,
		"Paused":              PendingStatusPaused,
		"Needs answer":        PendingStatusNeedsAnswer,
		"Failed":              PendingStatusFailed,
		"Completed":           PendingStatusDone,
		"Skipped":             PendingStatusDone,
		"Retried":             PendingStatusQueued, // ids 3 (failed) and 9 (no state): the highest id decides
		"Spelled differently": PendingStatusRunning,
	}
	got := statusByRole(rows)
	for role, status := range want {
		if got[role] != status {
			t.Errorf("%s: status = %q, want %q", role, got[role], status)
		}
	}
}

// writeBatchCheckoutFiles marks root as a checkout and writes its batch files.
func writeBatchCheckoutFiles(t *testing.T, root, input, state string) {
	t.Helper()
	writeTestFile(t, filepath.Join(root, repoRootMarker), "// marker\n")
	writeTestFile(t, filepath.Join(root, "batch", "batch-input.tsv"), input)
	writeTestFile(t, filepath.Join(root, "batch", "batch-state.tsv"), state)
}

func TestLoadPendingRowsReadsBatchFilesWhereTheTrackerLookupDoes(t *testing.T) {
	// The data root is not the checkout: the batch files come from the
	// checkout, through the same batchFilePath the tracker's URL lookup uses.
	checkout := t.TempDir()
	writeBatchCheckoutFiles(t, checkout, statusInput, statusState)
	dataRoot := t.TempDir()
	writePending(t, dataRoot, statusPipeline)
	stale := strings.ReplaceAll(statusState, "processing", "failed")
	writeTestFile(t, filepath.Join(dataRoot, "batch", "batch-input.tsv"), statusInput)
	writeTestFile(t, filepath.Join(dataRoot, "batch", "batch-state.tsv"), stale)
	chdirForTest(t, checkout)

	rows, err := LoadPendingRows(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	if got := statusByRole(rows)["Running"]; got != PendingStatusRunning {
		t.Fatalf("Running read as %q: the data root's batch copy was used", got)
	}
}

func TestLoadPendingRowsWithoutBatchFilesHasNoStatus(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, repoRootMarker), "// marker\n")
	writePending(t, root, statusPipeline)
	chdirForTest(t, root)
	rows, err := LoadPendingRows(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Status != PendingStatusNone {
			t.Fatalf("%s: status = %q with no batch files", row.Role, row.Status)
		}
	}
}

func TestLoadPendingRowsReportsAnUnreadableBatchFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("a directory read fails differently on Windows; the ErrNotExist branch is what matters")
	}
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, repoRootMarker), "// marker\n")
	writeTestFile(t, filepath.Join(root, "batch", "batch-input.tsv"), statusInput)
	if err := os.MkdirAll(filepath.Join(root, "batch", "batch-state.tsv"), 0o755); err != nil {
		t.Fatal(err)
	}
	writePending(t, root, statusPipeline)
	chdirForTest(t, root)
	if _, err := LoadPendingRows(root); err == nil {
		t.Fatal("an unreadable batch-state.tsv read as no status")
	}
}

func hashFiles(t *testing.T, paths ...string) map[string][32]byte {
	t.Helper()
	out := map[string][32]byte{}
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			t.Fatalf("read %s: %v", p, err)
		}
		out[p] = sha256.Sum256(b)
	}
	return out
}

func TestLoadPendingRowsChangesNoFile(t *testing.T) {
	root := t.TempDir()
	writeBatchCheckoutFiles(t, root, statusInput, statusState)
	writePending(t, root, statusPipeline)
	chdirForTest(t, root)
	files := []string{
		filepath.Join(root, "data", "pipeline.md"),
		filepath.Join(root, "batch", "batch-input.tsv"),
		filepath.Join(root, "batch", "batch-state.tsv"),
	}
	before := hashFiles(t, files...)
	entriesBefore := listTree(t, root)
	if _, err := LoadPendingRows(root); err != nil {
		t.Fatal(err)
	}
	after := hashFiles(t, files...)
	for _, p := range files {
		if before[p] != after[p] {
			t.Errorf("%s changed", p)
		}
	}
	if got := listTree(t, root); strings.Join(got, "\n") != strings.Join(entriesBefore, "\n") {
		t.Errorf("files were added or removed:\nbefore %v\nafter  %v", entriesBefore, got)
	}
}

func listTree(t *testing.T, root string) []string {
	t.Helper()
	var out []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		out = append(out, path)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// pendingParityRow is the shape tests/dashboard-pending-parity.test.mjs also
// checks the web parseInbox against, from the same two files.
type pendingParityRow struct {
	URL      string   `json:"url"`
	Company  string   `json:"company"`
	Role     string   `json:"role"`
	Location string   `json:"location"`
	Posted   string   `json:"posted"`
	Rank     *float64 `json:"rank"`
}

func TestPendingRowsMatchTheSharedParityFixture(t *testing.T) {
	md, err := os.ReadFile(filepath.Join("testdata", "pending-parity.md"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join("testdata", "pending-parity.json"))
	if err != nil {
		t.Fatal(err)
	}
	var want []pendingParityRow
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	rows := ParsePendingRows(string(md))
	if len(rows) != len(want) {
		t.Fatalf("got %d rows, fixture expects %d", len(rows), len(want))
	}
	for i, row := range rows {
		got := pendingParityRow{URL: row.URL, Company: row.Company, Role: row.Role, Location: row.Location, Posted: row.Posted}
		if row.HasRank {
			rank := row.Rank
			got.Rank = &rank
		}
		g, err := json.Marshal(got)
		if err != nil {
			t.Fatal(err)
		}
		w, err := json.Marshal(want[i])
		if err != nil {
			t.Fatal(err)
		}
		if string(g) != string(w) {
			t.Errorf("row %d:\n got  %s\n want %s", i, g, w)
		}
	}
}

func TestPendingURLKeyNormalizesLightly(t *testing.T) {
	same := [][2]string{
		{"https://Jobs.Example.com", "https://jobs.example.com/"},
		{"HTTPS://jobs.example.com:443/a", "https://jobs.example.com/a"},
		{"http://jobs.example.com:80/a?b=1", "http://jobs.example.com/a?b=1"},
	}
	for _, pair := range same {
		if pendingURLKey(pair[0]) != pendingURLKey(pair[1]) {
			t.Errorf("%q and %q should join", pair[0], pair[1])
		}
	}
	different := [][2]string{
		{"https://jobs.example.com/a", "https://jobs.example.com/b"},
		{"https://jobs.example.com:8443/a", "https://jobs.example.com/a"},
		{"https://jobs.example.com/a?id=1", "https://jobs.example.com/a?id=2"},
		{"local:jds/a.md", "local:jds/A.md"},
	}
	for _, pair := range different {
		if pendingURLKey(pair[0]) == pendingURLKey(pair[1]) {
			t.Errorf("%q and %q should stay apart", pair[0], pair[1])
		}
	}
}
