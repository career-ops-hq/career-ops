package i18n

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// The language key must be able to reach every language.
//
// ToggleLang flipped between &En and &Tr, with every other catalog falling into
// the else branch and landing on English. Spanish was added afterwards, so a
// user who started the dashboard in Spanish pressed the key the help bar
// advertises as "lang" and could not get back to it: from Es the toggle went to
// En, and from there it could only ever reach En and Tr.
//
// The pre-existing test never toggled FROM Es, which is why the gap survived —
// it asserted En -> Tr and Tr -> En and stopped there.

func TestToggleLangReachesEveryLanguage(t *testing.T) {
	t.Cleanup(func() { Current = &En })

	// Start from each language in turn and confirm the cycle returns to it,
	// which is the property that was missing: reachable, and reachable BACK.
	for _, start := range languages {
		Current = start.catalog
		seen := map[string]bool{start.code: true}

		for i := 0; i < len(languages); i++ {
			ToggleLang()
			seen[GetLang()] = true
		}

		if GetLang() != start.code {
			t.Errorf("starting from %q, %d toggles landed on %q — the cycle does not return",
				start.code, len(languages), GetLang())
		}
		for _, l := range languages {
			if !seen[l.code] {
				t.Errorf("starting from %q, the toggle never reached %q", start.code, l.code)
			}
		}
	}
}

func TestToggleLangFromAnUnlistedCatalogLandsSomewhereDefined(t *testing.T) {
	// Current can only point outside the list through a bug, but leaving it
	// unchanged would make the advertised key do nothing at all — the worst
	// outcome for a key the help bar promises.
	t.Cleanup(func() { Current = &En })
	stray := &Catalog{AppTitle: "stray"}
	Current = stray

	ToggleLang()
	if Current == stray {
		t.Error("the language key must always change something")
	}
	if GetLang() != "en" {
		t.Errorf("expected the English fallback, got %q", GetLang())
	}
}

func TestEveryDeclaredCatalogIsInTheCycle(t *testing.T) {
	// The guard that stops this rotting the way ToggleLang did. A language added
	// as `var Fr = Catalog{…}` but not added to `languages` is unreachable from
	// the toggle AND invisible to GetLang, exactly the Spanish situation again.
	src, err := os.ReadFile(filepath.Join("catalog.go"))
	if err != nil {
		t.Fatalf("read catalog.go: %v", err)
	}
	declared := regexp.MustCompile(`(?m)^var (\w+) = Catalog\{`).FindAllStringSubmatch(string(src), -1)
	if len(declared) == 0 {
		t.Fatal("found no `var X = Catalog{` declarations — this check has lost its subject")
	}

	inCycle := map[*Catalog]bool{}
	for _, entry := range languages {
		inCycle[entry.catalog] = true
	}
	byName := map[string]*Catalog{"En": &En, "Tr": &Tr, "Es": &Es}

	for _, m := range declared {
		name := m[1]
		cat, known := byName[name]
		if !known {
			t.Errorf("catalog.go declares %s but this test cannot resolve it — add it to byName and to `languages`", name)
			continue
		}
		if !inCycle[cat] {
			t.Errorf("%s is declared but not in `languages`, so the toggle can never reach it", name)
		}
	}
}

func TestSetLangStillMatchesOnPrefix(t *testing.T) {
	// `languages` now drives SetLang too, so the prefix behaviour has to be
	// re-proved rather than assumed: "en" and "es" share a first letter, and
	// iterating a list is not the same code path as the old switch.
	t.Cleanup(func() { Current = &En })

	for _, tc := range []struct{ in, want string }{
		{"en", "en"}, {"en_US", "en"}, {"english", "en"},
		{"tr", "tr"}, {"tr_TR", "tr"},
		{"es", "es"}, {"es_ES", "es"}, {"espanol", "es"},
		{"fr", "en"}, {"", "en"}, {"  ES_es  ", "es"},
	} {
		SetLang(tc.in)
		if got := GetLang(); got != tc.want {
			t.Errorf("SetLang(%q) -> %q; want %q", tc.in, got, tc.want)
		}
	}
}
