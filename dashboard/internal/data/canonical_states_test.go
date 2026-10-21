package data

import (
	"os"
	"path/filepath"
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
// Parsed with a regex rather than a YAML library because the Go module has no
// YAML dependency and adding one so a test can read ten ids is not a trade
// worth making. The shape is `  - id: name`, and the guards below fail loudly
// if that stops matching.

var stateIDRe = regexp.MustCompile(`(?m)^\s*-\s+id:\s*([a-z_]+)\s*$`)

// repoRoot walks up from the test's directory to the checkout that holds
// templates/states.yml, so the test does not depend on how deep the package is.
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "templates", "states.yml")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Skip("templates/states.yml not found above the package directory — not a full checkout")
	return ""
}

func canonicalStatesFromYAML(t *testing.T) []string {
	t.Helper()
	path := filepath.Join(repoRoot(t), "templates", "states.yml")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var ids []string
	for _, m := range stateIDRe.FindAllStringSubmatch(string(content), -1) {
		ids = append(ids, m[1])
	}
	// Guard on the guard. If the file's shape changes and the regex stops
	// matching, every assertion below would pass over an empty list and report
	// as coverage — the exact failure mode this test exists to prevent.
	if len(ids) < 8 {
		t.Fatalf("parsed only %d state ids from states.yml (%v) — the parse has lost its subject", len(ids), ids)
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
