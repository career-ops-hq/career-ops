package theme

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"testing"
)

// Every theme must define every colour.
//
// Lower stakes than the catalog guard in internal/i18n — a missing colour
// renders unstyled rather than removing information — but the same silent
// mechanism, in a package that had no tests at all. A Theme literal that omits
// a field compiles, and lipgloss renders the resulting "" as "no colour", so a
// field added to Theme and set in only one constructor leaves the other theme
// quietly unstyled in that one spot. Nobody running the default theme would
// ever see it.
//
// Both themes are complete today (13/13, measured), so this is a ratchet rather
// than a backlog.

var themeCtorRe = regexp.MustCompile(`(?m)^func (new\w+)\(\) Theme \{`)

// themes maps each constructor's name to what it returns.
//
// Hand-written, because Go cannot enumerate a package's functions — but not
// trusted to be complete: the test below reads the package source and fails if
// a constructor exists there and is missing from here, so a new theme fails
// with "add it to this map" instead of being silently skipped.
var themes = map[string]func() Theme{
	"newCatppuccinMocha": newCatppuccinMocha,
	"newCatppuccinLatte": newCatppuccinLatte,
}

func declaredThemeCtors(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".go" {
			continue
		}
		src, err := os.ReadFile(e.Name())
		if err != nil {
			t.Fatalf("read %s: %v", e.Name(), err)
		}
		for _, m := range themeCtorRe.FindAllStringSubmatch(string(src), -1) {
			names = append(names, m[1])
		}
	}
	if len(names) == 0 {
		t.Fatal("found no `func newX() Theme` constructors — this check has lost its subject")
	}
	return names
}

func TestEveryDeclaredThemeIsUnderTest(t *testing.T) {
	for _, name := range declaredThemeCtors(t) {
		if _, ok := themes[name]; !ok {
			t.Errorf("%s is declared in this package but missing from the themes map in this file — add it", name)
		}
	}
}

func TestEveryThemeFieldIsSet(t *testing.T) {
	rt := reflect.TypeOf(Theme{})
	if rt.NumField() == 0 {
		t.Fatal("Theme has no fields — this check has lost its subject")
	}

	for name, ctor := range themes {
		v := reflect.ValueOf(ctor())
		var blank []string
		for i := 0; i < rt.NumField(); i++ {
			f := rt.Field(i)
			// lipgloss.Color is a string kind, which is what makes the zero
			// value invisible; a non-string field has its own meaning for it.
			if f.Type.Kind() != reflect.String {
				continue
			}
			if v.Field(i).String() == "" {
				blank = append(blank, f.Name)
			}
		}
		if len(blank) > 0 {
			t.Errorf("%s leaves %d colour(s) empty, which render unstyled: %v", name, len(blank), blank)
		}
	}
}

func TestNewThemeNeverReturnsAnEmptyTheme(t *testing.T) {
	// NewTheme's default branch already returns a real theme rather than a zero
	// value — asserted so it stays that way, since an unknown --theme flag
	// landing on Theme{} would render the whole TUI unstyled.
	for _, name := range []string{"catppuccin-mocha", "catppuccin-latte", "auto", "", "no-such-theme", "CATPPUCCIN-MOCHA"} {
		got := NewTheme(name)
		rt := reflect.TypeOf(got)
		v := reflect.ValueOf(got)
		for i := 0; i < rt.NumField(); i++ {
			if rt.Field(i).Type.Kind() != reflect.String {
				continue
			}
			if v.Field(i).String() == "" {
				t.Errorf("NewTheme(%q) left %s empty", name, rt.Field(i).Name)
			}
		}
	}
}
