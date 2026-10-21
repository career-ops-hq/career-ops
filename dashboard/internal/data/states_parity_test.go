package data

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type canonicalState struct {
	id, label string
	aliases   []string
}

// loadCanonicalStates reads the id, label and aliases of every state in
// templates/states.yml. The module has no YAML dependency, so this reads the
// three keys the file actually uses, in the form it writes them (an inline
// `aliases: [a, "b c"]` list). A states.yml that stops looking like that fails
// here instead of being half-read into a test that then passes on nothing.
func loadCanonicalStates(t *testing.T) []canonicalState {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "templates", "states.yml"))
	if err != nil {
		t.Fatal(err)
	}
	unquote := func(v string) string { return strings.Trim(strings.TrimSpace(v), `"'`) }
	var states []canonicalState
	for _, line := range strings.Split(string(content), "\n") {
		trimmed := strings.TrimSpace(line)
		if id, ok := strings.CutPrefix(trimmed, "- id:"); ok {
			states = append(states, canonicalState{id: unquote(id)})
			continue
		}
		if len(states) == 0 {
			continue
		}
		cur := &states[len(states)-1]
		if label, ok := strings.CutPrefix(trimmed, "label:"); ok {
			cur.label = unquote(label)
		}
		if list, ok := strings.CutPrefix(trimmed, "aliases:"); ok {
			list = strings.TrimSpace(list)
			if !strings.HasPrefix(list, "[") || !strings.HasSuffix(list, "]") {
				t.Fatalf("state %q: aliases is not an inline [..] list (%q); teach loadCanonicalStates the new form", cur.id, list)
			}
			for _, alias := range strings.Split(list[1:len(list)-1], ",") {
				if alias = unquote(alias); alias != "" {
					cur.aliases = append(cur.aliases, alias)
				}
			}
		}
	}
	if len(states) == 0 {
		t.Fatal("no states parsed from templates/states.yml")
	}
	for _, st := range states {
		if st.id == "" || st.label == "" || len(st.aliases) == 0 {
			t.Fatalf("state %+v parsed without an id, label or aliases; the guard would check nothing for it", st)
		}
	}
	return states
}

// states.yml is the source of truth Node and web load directly. NormalizeStatus
// is Go's compiled copy, so every spelling the file accepts has to land on the
// same state here, or one tracker row reads differently in the TUI than it does
// everywhere else. test-all.mjs guards the opposite direction (#2704).
func TestNormalizeStatusCoversStatesYAML(t *testing.T) {
	for _, st := range loadCanonicalStates(t) {
		for _, spelling := range append([]string{st.id, st.label}, st.aliases...) {
			if got := NormalizeStatus(spelling); got != st.id {
				t.Errorf("NormalizeStatus(%q) = %q; templates/states.yml says %q", spelling, got, st.id)
			}
		}
	}
}
