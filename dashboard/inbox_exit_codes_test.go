package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"
)

// The Inbox keys read meaning from the scripts' exit statuses (#5269). A
// renumbering on the script side would turn a no-op into a failure, or the
// reverse, with nothing else noticing, so the constants main.go switches on
// are checked against the objects the scripts export.
func TestInboxExitCodesMatchTheScripts(t *testing.T) {
	cases := []struct {
		script, object string
		want           map[string]int
	}{
		{"sync-batch-input.mjs", "URL_EXIT", map[string]int{
			"ALREADY_QUEUED": queueExitAlreadyQueued, "NOT_PENDING": queueExitNotPending,
		}},
		{"inbox-skip.mjs", "SKIP_EXIT", map[string]int{
			"UNCHANGED": skipExitUnchanged, "NOT_PENDING": skipExitNotPending,
		}},
		{"rank-pipeline.mjs", "RANK_EXIT", map[string]int{
			"NOT_PENDING": rankExitNotPending,
		}},
	}
	for _, c := range cases {
		src, err := os.ReadFile(filepath.Join("..", c.script))
		if err != nil {
			t.Fatalf("read %s: %v", c.script, err)
		}
		body := regexp.MustCompile(`export const ` + c.object + ` = Object\.freeze\(\{([^}]*)\}\)`).FindSubmatch(src)
		if body == nil {
			t.Fatalf("%s no longer exports %s as Object.freeze({...}); update this test", c.script, c.object)
		}
		got := map[string]int{}
		for _, m := range regexp.MustCompile(`(\w+)\s*:\s*(\d+)`).FindAllSubmatch(body[1], -1) {
			n, _ := strconv.Atoi(string(m[2]))
			got[string(m[1])] = n
		}
		for name, want := range c.want {
			if got[name] != want {
				t.Errorf("%s.%s in %s is %d, main.go switches on %d", c.object, name, c.script, got[name], want)
			}
		}
		if len(got) != len(c.want) {
			t.Errorf("%s in %s has %v; main.go handles %v", c.object, c.script, got, c.want)
		}
	}
}
