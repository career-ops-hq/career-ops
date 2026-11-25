package data

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The dashboard's canonical-status list must match templates/states.yml.
//
// states.yml says so itself: "Source of truth for career-ops (writer) and
// dashboard (reader). Both systems MUST use these exact states." It also
// explains that its lifecycle ordering is consumed by tracker-sync-check.mjs
// "so a new state added here can't silently fall through as unrecognized" —
// and that is guarded for the mjs side. Nothing guarded it for the Go side.
//
// The Go copy is a hardcoded switch:
//
//	// Reject malformed UI input cheaply; the writer validates against states.yml.
//	func isCanonicalStatusName(status string) bool {
//		switch strings.ToLower(status) {
//		case "evaluated", "applied", … :
//
// with "keep in sync with career-ops/states.yml" written above NormalizeStatus
// and nothing enforcing it. `assessment` is in that list only because the PR
// that added the state hand-edited it; the next state would be silently
// REJECTED by the dashboard as malformed input, which is a functional failure
// rather than a cosmetic one — the user picks a valid status and the UI refuses.
//
// The ids come from loadCanonicalStates (states_parity_test.go), the one
// reader of states.yml in this package. It fails the test when the file is
// missing or no longer parses, because a skipped parity guard looks the same
// as a passing one.

func canonicalStatesFromYAML(t *testing.T) []string {
	t.Helper()
	states := loadCanonicalStates(t)
	ids := make([]string, len(states))
	for i, st := range states {
		ids[i] = st.id
	}
	return ids
}

func TestEveryCanonicalStateIsAcceptedByTheDashboard(t *testing.T) {
	for _, id := range canonicalStatesFromYAML(t) {
		if !isCanonicalStatusName(id) {
			t.Errorf("states.yml declares %q but isCanonicalStatusName rejects it — the dashboard would refuse a valid status as malformed input", id)
		}
		// Case-insensitively too, since the UI passes whatever the user picked
		// and states.yml says the match is case-insensitive.
		for _, variant := range []string{strings.ToUpper(id), strings.Title(id)} { //nolint:staticcheck // strings.Title is adequate for ASCII state ids
			if !isCanonicalStatusName(variant) {
				t.Errorf("isCanonicalStatusName rejects %q, but states.yml matches case-insensitively", variant)
			}
		}
	}
}

func TestTheDashboardAcceptsNothingBeyondStatesYAML(t *testing.T) {
	// The other direction, which matters when a state is REMOVED or renamed
	// upstream: a stale name left in the Go switch keeps the dashboard writing
	// a status the core no longer recognises.
	declared := map[string]bool{}
	for _, id := range canonicalStatesFromYAML(t) {
		declared[id] = true
	}

	// The switch is not enumerable, so the list is read from the source. Same
	// reasoning as the catalog guard in internal/i18n: discovery beats a second
	// hand-written copy, because a second copy is the bug.
	src, err := os.ReadFile("career.go")
	if err != nil {
		t.Fatalf("read career.go: %v", err)
	}
	fn := string(src)
	start := strings.Index(fn, "func isCanonicalStatusName(")
	if start < 0 {
		t.Fatal("isCanonicalStatusName not found in career.go — this check has lost its subject")
	}
	body := fn[start:]
	if end := strings.Index(body, "\n}"); end > 0 {
		body = body[:end]
	}

	accepted := regexp.MustCompile(`"([a-z_]+)"`).FindAllStringSubmatch(body, -1)
	if len(accepted) < 8 {
		t.Fatalf("found only %d quoted names in isCanonicalStatusName — the parse has lost its subject", len(accepted))
	}

	var stale []string
	for _, m := range accepted {
		if !declared[m[1]] {
			stale = append(stale, m[1])
		}
	}
	sort.Strings(stale)
	if len(stale) > 0 {
		t.Errorf("isCanonicalStatusName accepts %v, which states.yml no longer declares — the dashboard would write a status the core does not recognise", stale)
	}
}

func TestNormalizeStatusRoundTripsEveryCanonicalState(t *testing.T) {
	// NormalizeStatus carries the same "keep in sync with states.yml" comment.
	// A canonical id must normalise to itself, or a status the dashboard just
	// wrote reads back as something else.
	for _, id := range canonicalStatesFromYAML(t) {
		if got := NormalizeStatus(id); got != id {
			t.Errorf("NormalizeStatus(%q) = %q; a canonical state must normalise to itself", id, got)
		}
	}
}
