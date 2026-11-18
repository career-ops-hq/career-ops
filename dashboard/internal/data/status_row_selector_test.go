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

// A backfill sentinel in the # column (#1799) leaves the row with no identity
// at all: Number is then only its position in the table, and renumbering or
// inserting a row above it would silently retarget the write.
func TestDashboardStatusRefusesRowWithoutIdentity(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	before := statusTargetHeader + strings.Replace(noReportRow, "| 32 |", "| N/A |", 1)
	root, tracker := writeTracker(t, before)

	apps := mustParseApplications(t, root)
	if len(apps) != 1 || !apps[0].TrackerNumberMissing {
		t.Fatalf("premise: one row with a sentinel #, got %+v", apps)
	}
	err := UpdateApplicationStatusAndNotes(root, apps[0], "Discarded", "")
	if err == nil || !strings.Contains(err.Error(), "no tracker identity") {
		t.Fatalf("want a refusal naming the missing identity, got %v", err)
	}
	assertStatusTargetBytes(t, tracker, before)
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
