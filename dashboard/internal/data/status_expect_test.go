package data

import (
	"strings"
	"testing"
)

// The status picker resolves a row selector when it is drawn and sends it when
// a key is pressed. Another session can renumber rows in between, so the write
// would land on whatever application took the number. --expect-status carries
// the status the picker DISPLAYED, so the stale selection is refused.
func TestDashboardStatusRefusesAStaleSelection(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	t.Setenv("CAREER_OPS_FOLLOWUPS_LOCK", "")
	root, tracker := writeTracker(t, statusTargetHeader+statusTargetRow)

	// What the picker drew.
	apps := mustParseApplications(t, root)
	if len(apps) != 1 || apps[0].Status != "Applied" {
		t.Fatalf("premise: one Applied row, got %+v", apps)
	}
	shown := apps[0]

	// Another session moves the row on while the picker is open.
	moved := statusTargetHeader + strings.Replace(statusTargetRow, "| Applied |", "| Interview |", 1)
	writeStatusTarget(t, tracker, moved)

	err := UpdateApplicationStatus(root, shown, "Rejected")
	if err == nil {
		t.Fatal("a status write against a row that moved under the picker must be refused")
	}
	// Reload-and-retry, not a bare failure: the row's own state is named and
	// the message says the list was reloaded.
	for _, want := range []string{"Interview", "reloaded, pick the status again"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("refusal must say %q, got %v", want, err)
		}
	}
	assertStatusTargetBytes(t, tracker, moved)

	// The expectation must not fail an ordinary write: re-read and save again.
	fresh := mustParseApplications(t, root)
	if err := UpdateApplicationStatus(root, fresh[0], "Rejected"); err != nil {
		t.Fatalf("a write from a freshly read row must still pass: %v", err)
	}
	if saved := mustParseApplications(t, root); saved[0].Status != "Rejected" {
		t.Fatalf("retry after reload did not save: %+v", saved[0])
	}
}

// The honest limit. set-status.mjs permits a status mismatch when the row
// already holds the requested status, so --expect-status is a partial
// mitigation and not a fix: a stale selection asking for the status the wrong
// row happens to hold is still written, and its note still lands there. Closing
// that needs --expect-row, which needs a Go trackerRowIdentity twin and its own
// cross-runtime parity test.
func TestDashboardStatusStillAllowsAStaleWriteToTheRequestedStatus(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	t.Setenv("CAREER_OPS_FOLLOWUPS_LOCK", "")
	root, tracker := writeTracker(t, statusTargetHeader+statusTargetRow)

	shown := mustParseApplications(t, root)[0]
	writeStatusTarget(t, tracker, statusTargetHeader+strings.Replace(statusTargetRow, "| Applied |", "| Rejected |", 1))

	if err := UpdateApplicationStatusAndNotes(root, shown, "Rejected", "DISCARD: stale"); err != nil {
		t.Fatalf("documented limit: this write is permitted today, got %v", err)
	}
	saved := mustParseApplications(t, root)
	if !strings.Contains(saved[0].Notes, "DISCARD: stale") {
		t.Fatalf("documented limit: the note lands on the row anyway, got %+v", saved[0])
	}
}
