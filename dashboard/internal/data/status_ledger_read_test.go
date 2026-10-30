package data

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// LatestDate must follow the ledger's own correction semantics (the fold in
// funnel-velocity.mjs), not a plain maximum: a retraction removes the latest
// observation and a correction re-dates the one it names.
func TestParseStatusLedgerLatestDate(t *testing.T) {
	ledger := strings.Join([]string{
		// 1: a plain forward march — latest is the last line.
		"1\t2026-06-01\tEvaluated\tApplied\tset-status\t",
		"1\t2026-06-08\tApplied\tResponded\tset-status\t",
		"1\t2026-06-15\tResponded\tInterview\tdashboard\t",
		// 2: a correction re-dates the Responded transition to an EARLIER day,
		// so the latest date must move back, which a max never does.
		"2\t2026-06-01\t-\tApplied\tset-status\tunknown prior state",
		"2\t2026-06-11\tApplied\tResponded\tset-status\t",
		"2\t2026-06-09\tApplied\tResponded\tcorrection\tthey actually replied on the 9th",
		// 3: a correction whose target was never observed is just a new observation.
		"3\t2026-06-05\tEvaluated\tApplied\tset-status\t",
		"3\t2026-06-07\tApplied\tResponded\tcorrection\t",
		// 5: a mis-click retracted the same day — only the Applied line survives.
		"5\t2026-06-01\tEvaluated\tApplied\tset-status\t",
		"5\t2026-06-02\tApplied\tInterview\tset-status\tmis-click",
		"5\t2026-06-02\t-\t-\tset-status\tretract the mis-click",
		// 6: an unknown source still yields a display date.
		"6\t2026-06-03\tEvaluated\tApplied\tfuture-import\tunknown source on purpose",
		// 7: a backfill line is the best information there is.
		"7\t2026-05-20\tEvaluated\tApplied\tbackfill\t",
		// 8: Reached still counts this line, but the date is unusable for display.
		"8\t06/01/2026\tEvaluated\tApplied\tset-status\tbad date",
		// 9: retraction on an empty timeline is a no-op, not a panic.
		"9\t2026-06-02\t-\t-\tset-status\tnothing to retract",
		// 10: an out-of-order backdated line never lowers the latest date.
		"10\t2026-06-10\tEvaluated\tApplied\tset-status\t",
		"10\t2026-06-04\tApplied\tResponded\tset-status\tbackdated with --on",
		// noise the parser must skip
		"x\t2026-06-01\tEvaluated\tApplied\tset-status\tbad num",
		"11\t\tEvaluated\tApplied\tset-status\tempty date",
		"12\t2026-06-01\t\tApplied\tset-status\tempty from",
		"short\tline",
		"",
		"# comment",
	}, "\n") + "\r\n"

	got := parseStatusLedger(ledger)
	want := map[int]string{
		1:  "2026-06-15",
		2:  "2026-06-09",
		3:  "2026-06-07",
		5:  "2026-06-01",
		6:  "2026-06-03",
		7:  "2026-05-20",
		10: "2026-06-10",
	}
	for num, date := range want {
		if got.LatestDate[num] != date {
			t.Errorf("LatestDate[%d] = %q, want %q", num, got.LatestDate[num], date)
		}
	}
	for _, absent := range []int{8, 9, 11, 12} {
		if d, ok := got.LatestDate[absent]; ok {
			t.Errorf("LatestDate[%d] = %q, want no entry", absent, d)
		}
	}
	// The funnel view is untouched by the date fold: row 8's bad date still
	// counts toward Reached, and row 5's retracted Interview still counts
	// (the rank rule has always been "ever written", and this change keeps it).
	if got.Reached[8] != 1 {
		t.Errorf("Reached[8] = %d, want 1 (lenient funnel rule unchanged)", got.Reached[8])
	}
	if got.Reached[1] != 4 {
		t.Errorf("Reached[1] = %d, want 4 (Interview follows Assessment)", got.Reached[1])
	}
	if parseFunnelHistory(ledger)[1] != got.Reached[1] {
		t.Error("parseFunnelHistory must be the Reached view of parseStatusLedger")
	}
}

func TestReadStatusLedgerMissingFile(t *testing.T) {
	root := t.TempDir()
	t.Setenv("CAREER_OPS_TRACKER", filepath.Join(root, "applications.md"))
	ledger, err := ReadStatusLedger(root)
	if err != nil || len(ledger.Reached) != 0 || len(ledger.LatestDate) != 0 {
		t.Fatalf("missing ledger = %+v, %v; want empty ledger without an error", ledger, err)
	}
}

func TestReadStatusLedgerPropagatesReadFailure(t *testing.T) {
	root := t.TempDir()
	t.Setenv("CAREER_OPS_TRACKER", filepath.Join(root, "applications.md"))
	ledgerPath := filepath.Join(root, "status-log.tsv")
	if err := os.Mkdir(ledgerPath, 0700); err != nil {
		t.Fatal(err)
	}
	ledger, err := ReadStatusLedger(root)
	var pathErr *os.PathError
	if !errors.As(err, &pathErr) || pathErr.Path != ledgerPath {
		t.Fatalf("read failure = %v, want the ledger's underlying PathError", err)
	}
	if ledger.Reached != nil || ledger.LatestDate != nil {
		t.Fatalf("failed read returned data: %+v", ledger)
	}
}

func TestReadStatusLedgerFollowsTrackerOverride(t *testing.T) {
	root := t.TempDir()
	t.Setenv("CAREER_OPS_TRACKER", filepath.Join(root, "custom.md"))
	if err := os.WriteFile(filepath.Join(root, "status-log.tsv"), []byte("1\t2026-09-01\tOffer\tDiscarded\tset-status\t\n"), 0600); err != nil {
		t.Fatal(err)
	}
	ledger, err := ReadStatusLedger(root)
	if err != nil {
		t.Fatal(err)
	}
	if ledger.LatestDate[1] != "2026-09-01" || ledger.Reached[1] != 5 {
		t.Fatalf("ledger beside overridden tracker = %+v", ledger)
	}
}

func TestApplyStatusDates(t *testing.T) {
	apps := []model.CareerApplication{
		{Number: 1, Date: "2026-05-01"},
		{Number: 2, Date: "2026-05-02"},
		{Number: 3, Date: "2026-05-03", TrackerNumberMissing: true}, // synthesized # collides with a real row's history
		{Number: 4, Date: "2026-05-04", StatusDate: "stale"},        // no entry: left untouched
	}
	ApplyStatusDates(apps, map[int]string{1: "2026-06-01", 3: "2026-06-03"})
	if apps[0].StatusDate != "2026-06-01" {
		t.Errorf("row 1 StatusDate = %q, want 2026-06-01", apps[0].StatusDate)
	}
	if apps[1].StatusDate != "" {
		t.Errorf("row 2 StatusDate = %q, want empty (no ledger history)", apps[1].StatusDate)
	}
	if apps[2].StatusDate != "" {
		t.Errorf("synthesized display number joined another row's history: %q", apps[2].StatusDate)
	}
	if apps[3].StatusDate != "stale" {
		t.Errorf("row 4 StatusDate = %q, want untouched", apps[3].StatusDate)
	}
	// nil / empty maps are a no-op, never a panic (failed ledger read path).
	ApplyStatusDates(apps, nil)
	ApplyStatusDates(nil, map[int]string{1: "2026-06-01"})
}
