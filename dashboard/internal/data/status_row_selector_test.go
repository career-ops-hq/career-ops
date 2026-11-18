package data

import (
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// A row added without an evaluation (`tracker` mode, a backfilled recruiter
// inbound) has no report link, so the dashboard has to name it by its tracker
// #. Before #7331 every such row was unreachable from the TUI: the status
// change was refused before set-status.mjs ran, and the only way to close it
// was the CLI.
const noReportRow = "| 32 | 2026-10-26 | Inbound Co | Senior Engineer | N/A | Evaluated | ❌ | — | inbound recruiter |\n"

func TestDashboardStatusWritesRowWithoutReportLink(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	t.Setenv("CAREER_OPS_FOLLOWUPS_LOCK", "")
	root, _ := writeTracker(t, statusTargetHeader+statusTargetRow+noReportRow)

	// Parse rather than hand-build the row, so Number and TrackerNumberMissing
	// are whatever the reader actually derives from a Report cell of "—".
	apps := mustParseApplications(t, root)
	if len(apps) != 2 {
		t.Fatalf("want two rows, got %d", len(apps))
	}
	target := apps[1]
	if target.ReportNumber != "" || target.TrackerNumberMissing || target.Number != 32 {
		t.Fatalf("premise: row 32 has a tracker # and no report link, got %+v", target)
	}

	if err := UpdateApplicationStatusAndNotes(root, target, "Discarded", "DISCARD: salary_too_low"); err != nil {
		t.Fatalf("status change on a row with no report link: %v", err)
	}

	saved := mustParseApplications(t, root)
	if saved[1].Status != "Discarded" {
		t.Fatalf("row 32 status = %q, want Discarded", saved[1].Status)
	}
	if saved[1].Notes != "inbound recruiter; DISCARD: salary_too_low" {
		t.Fatalf("row 32 notes = %q", saved[1].Notes)
	}
	// The selector must address one row: the row carrying a report link #7 is
	// also the row whose tracker # is 42, and neither may move.
	if saved[0].Status != "Applied" || saved[0].Notes != "original" {
		t.Fatalf("the other row changed: %+v", saved[0])
	}
}

// Two # cells name no row. A backfill sentinel (#1799) leaves Number as only
// the row's position in the table, so inserting a row above it would retarget
// the write. A literal 0 is worse than useless: set-status.mjs takes `--row 0`
// and saves the status, but followup-seed.mjs rejects a non-positive
// application number, so an Applied write reports a partial save and no retry
// can ever repair it. Both are refused before anything is written.
func TestDashboardStatusRefusesRowWithoutIdentity(t *testing.T) {
	for _, cell := range []string{"N/A", "0"} {
		t.Run(cell, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", "")
			t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
			before := statusTargetHeader + strings.Replace(noReportRow, "| 32 |", "| "+cell+" |", 1)
			root, tracker := writeTracker(t, before)

			apps := mustParseApplications(t, root)
			if len(apps) != 1 {
				t.Fatalf("premise: one row, got %+v", apps)
			}
			// The two reach trackerIdentities differently: the sentinel as
			// TrackerNumberMissing, the 0 as a number the reader accepts.
			if cell == "0" && apps[0].TrackerNumberMissing {
				t.Fatalf("premise: a 0 cell parses as a number, got %+v", apps[0])
			}
			err := UpdateApplicationStatusAndNotes(root, apps[0], "Applied", "")
			if err == nil || !strings.Contains(err.Error(), "no tracker identity") {
				t.Fatalf("want a refusal naming the missing identity, got %v", err)
			}
			assertStatusTargetBytes(t, tracker, before)
		})
	}
}

// A row can answer to both selectors. The order matters twice: the report link
// is what the write names, and a pending repair filed under one identity has to
// be findable under the other, since a merge can add a report link to the row a
// failed write saved as `--row N`.
func TestTrackerIdentitiesKeepsBothSelectors(t *testing.T) {
	both := trackerIdentities(model.CareerApplication{Number: 42, ReportNumber: "7"})
	if len(both) != 2 || both[0] != (trackerIdentity{"--report-link", "7"}) || both[1] != (trackerIdentity{"--row", "42"}) {
		t.Fatalf("want the report link first and the tracker # second, got %+v", both)
	}
	if only := trackerIdentities(model.CareerApplication{Number: 32}); len(only) != 1 || only[0] != (trackerIdentity{"--row", "32"}) {
		t.Fatalf("a row with no report link carries one identity, got %+v", only)
	}
	for name, app := range map[string]model.CareerApplication{
		"sentinel #": {Number: 1, TrackerNumberMissing: true},
		"#0":         {Number: 0},
		"negative #": {Number: -1},
	} {
		if ids := trackerIdentities(app); len(ids) != 0 {
			t.Fatalf("%s must carry no identity, got %+v", name, ids)
		}
	}
}

// A tracker # duplicated across two rows (#1704) is the one case where the
// fallback selector is not unique. set-status.mjs refuses to guess which row
// to edit, and that refusal has to reach the footer instead of a silent write.
func TestDashboardStatusReportsDuplicateTrackerNumber(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	before := statusTargetHeader + noReportRow + strings.Replace(noReportRow, "Inbound Co", "Other Co", 1)
	root, tracker := writeTracker(t, before)

	apps := mustParseApplications(t, root)
	if len(apps) != 2 || apps[0].Number != apps[1].Number {
		t.Fatalf("premise: two rows sharing one #, got %+v", apps)
	}
	err := UpdateApplicationStatusAndNotes(root, apps[0], "Discarded", "")
	if err == nil || !strings.Contains(err.Error(), "duplicate tracker number") {
		t.Fatalf("want the duplicate-# refusal, got %v", err)
	}
	assertStatusTargetBytes(t, tracker, before)
}

func TestSameTrackerRowComparesOneNumberSpace(t *testing.T) {
	report32 := model.CareerApplication{Number: 7, ReportNumber: "32"}
	row32 := model.CareerApplication{Number: 32}
	sentinel := model.CareerApplication{Number: 1, TrackerNumberMissing: true}

	// Report #32 and row #32 are different applications: the two counters share
	// one number space, so a bare number cannot be compared across them.
	if SameTrackerRow(report32, row32) {
		t.Fatal("report #32 must not match row #32")
	}
	if !SameTrackerRow(report32, model.CareerApplication{Number: 99, ReportNumber: "32", Status: "Applied"}) {
		t.Fatal("the report link must match regardless of the row's other cells")
	}
	if !SameTrackerRow(row32, model.CareerApplication{Number: 32, Status: "Discarded"}) {
		t.Fatal("a row with no report link must match on its tracker #")
	}
	// A row no selector addresses matches nothing, itself included.
	if SameTrackerRow(sentinel, sentinel) {
		t.Fatal("a row with no identity must not match")
	}
	if HasTrackerIdentity(sentinel) {
		t.Fatal("a sentinel # is not an identity")
	}
	if !HasTrackerIdentity(row32) || !HasTrackerIdentity(report32) {
		t.Fatal("a tracker # and a report link are both identities")
	}
}

// A merge can attach a report link to a row that had none, which changes the
// selector a write would PREFER without changing the row. Comparing the
// preferred selector of each would stop recognising it, so the sets intersect.
func TestSameTrackerRowFollowsARowThatGainsAReportLink(t *testing.T) {
	before := model.CareerApplication{Number: 32}
	after := model.CareerApplication{Number: 32, ReportNumber: "7", Status: "Applied"}

	if !SameTrackerRow(before, after) {
		t.Fatal("a row that gained a report link is still the same row")
	}
	if !SameTrackerRow(after, before) {
		t.Fatal("the comparison must not depend on argument order")
	}
	// The flag is part of each key, so the two counters still never collide: a
	// row numbered #7 is not the row linking report #7.
	if SameTrackerRow(after, model.CareerApplication{Number: 7}) {
		t.Fatal("report #7 must not match row #7")
	}
	// Writes still prefer the report link once there is one.
	flag, value, ok := trackerSelector(after)
	if !ok || flag != "--report-link" || value != "7" {
		t.Fatalf("want --report-link 7, got %s %s (ok=%v)", flag, value, ok)
	}
}

// SanitizeTerminalText deletes control characters, so a # cell read after it
// ran can disagree with set-status.mjs about which row a number names: `3<US>2`
// sanitizes to `32`, and the write lands on whichever row genuinely holds 32 —
// unique there, so the duplicate-# guard never fires. The reader decides from
// the raw cell instead; parseInt (tracker-parse.mjs) stops at the same first
// non-digit.
func TestTrackerNumberIsReadFromTheRawCell(t *testing.T) {
	for name, cell := range map[string]string{
		"unit separator": "3\u001f2",
		"NUL":            "32\u0000",
		"DEL":            "3\u007f2",
		"ANSI reset":     "\u001b[0m32",
		"space":          "3 2",
		"trailing x":     "32x",
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", "")
			t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
			before := statusTargetHeader + strings.Replace(noReportRow, "| 32 |", "| "+cell+" |", 1)
			root, tracker := writeTracker(t, before)

			apps := mustParseApplications(t, root)
			if len(apps) != 1 {
				t.Fatalf("premise: one row, got %+v", apps)
			}
			if !apps[0].TrackerNumberMissing {
				t.Fatalf("a # cell of %q names no row, got Number=%d missing=false", cell, apps[0].Number)
			}
			// No identity means the write is refused, not retargeted.
			err := UpdateApplicationStatusAndNotes(root, apps[0], "Applied", "")
			if err == nil || !strings.Contains(err.Error(), "no tracker identity") {
				t.Fatalf("want a refusal naming the missing identity, got %v", err)
			}
			assertStatusTargetBytes(t, tracker, before)
		})
	}

	// A plain cell still parses, so the fix refuses no ordinary row.
	t.Setenv("CAREER_OPS_TRACKER", "")
	root, _ := writeTracker(t, statusTargetHeader+noReportRow)
	apps := mustParseApplications(t, root)
	if len(apps) != 1 || apps[0].TrackerNumberMissing || apps[0].Number != 32 {
		t.Fatalf("a plain # cell must parse as 32, got %+v", apps)
	}
}
