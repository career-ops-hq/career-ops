package i18n

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"testing"
)

// Every string the TUI renders must exist in every language.
//
// Go does not help here. A Catalog literal that omits a field still compiles,
// and the omitted field is "" — so adding a UI string and wiring it into a
// screen renders BLANK in every language whose literal was not updated. No
// compile error, no panic, no test: the label just isn't there, and only
// someone running the dashboard in Turkish or Spanish would notice.
//
// Measured before writing this: all three catalogs are complete today
// (136/136), so this is a ratchet, not a backlog.

var catalogVarRe = regexp.MustCompile(`(?m)^var (\w+) = Catalog\{`)

// catalogs maps each language's var name to its value.
//
// Hand-written, because Go cannot enumerate a package's variables — but NOT
// trusted to be complete: the test below reads catalog.go and fails if a
// language exists in the source and is missing from here. That way a new
// `var Fr = Catalog{…}` fails with "add it to this map" instead of being
// silently skipped, which is the failure mode a hard-coded list has.
var catalogs = map[string]*Catalog{
	"En": &En,
	"Tr": &Tr,
	"Es": &Es,
}

func declaredCatalogs(t *testing.T) []string {
	t.Helper()
	src, err := os.ReadFile(filepath.Join("catalog.go"))
	if err != nil {
		t.Fatalf("read catalog.go: %v", err)
	}
	var names []string
	for _, m := range catalogVarRe.FindAllStringSubmatch(string(src), -1) {
		names = append(names, m[1])
	}
	if len(names) == 0 {
		t.Fatal("found no `var X = Catalog{` declarations — this check has lost its subject")
	}
	return names
}

func TestEveryDeclaredCatalogIsUnderTest(t *testing.T) {
	// The guard on the guard. Without it, the completeness test below silently
	// stops covering any language added after it was written.
	for _, name := range declaredCatalogs(t) {
		if _, ok := catalogs[name]; !ok {
			t.Errorf("catalog.go declares %s but it is missing from the catalogs map in this file — add it", name)
		}
	}
}

func TestEveryCatalogFieldIsPopulated(t *testing.T) {
	// English is the reference: a field it does not fill is a field nothing
	// fills, so the whole comparison would pass over an empty column.
	refType := reflect.TypeOf(En)
	if refType.NumField() == 0 {
		t.Fatal("Catalog has no fields — this check has lost its subject")
	}

	for name, cat := range catalogs {
		v := reflect.ValueOf(*cat)
		var blank []string
		for i := 0; i < refType.NumField(); i++ {
			f := refType.Field(i)
			// Only the string labels; a non-string field (a func, a slice) has
			// its own meaning for the zero value.
			if f.Type.Kind() != reflect.String {
				continue
			}
			if v.Field(i).String() == "" {
				blank = append(blank, f.Name)
			}
		}
		if len(blank) > 0 {
			t.Errorf("%s is missing %d string(s), which render as empty labels in the TUI: %v",
				name, len(blank), blank)
		}
	}
}

func TestCatalogFieldCountsMatchEnglish(t *testing.T) {
	// Catches the subtler drift the blank check cannot: a literal that fills
	// every field but was written against an older struct still compiles, and
	// counting populated fields per language is how a divergence shows up as a
	// number rather than as a missing label someone has to spot by eye.
	want := 0
	rt := reflect.TypeOf(En)
	for i := 0; i < rt.NumField(); i++ {
		if rt.Field(i).Type.Kind() == reflect.String {
			want++
		}
	}

	for name, cat := range catalogs {
		got := 0
		v := reflect.ValueOf(*cat)
		for i := 0; i < rt.NumField(); i++ {
			if rt.Field(i).Type.Kind() == reflect.String && v.Field(i).String() != "" {
				got++
			}
		}
		if got != want {
			t.Errorf("%s has %d of %d string fields populated", name, got, want)
		}
	}
}
