package data

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Node and web load this JSON directly; Go's compiled mirror must cover the
// entire table, including older aliases, rather than just this PR's additions.
func TestTrackerHeaderAliasesMatchSharedJSON(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "tracker-aliases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var aliases map[string]string
	if err := json.Unmarshal(content, &aliases); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(trackerHeaderAliases, aliases) {
		t.Errorf("Go tracker aliases differ from tracker-aliases.json: got %v, want %v", trackerHeaderAliases, aliases)
	}
}

func TestLocalizedTrackerHeaders(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	markets := []struct{ mode, date, company, role string }{
		{"de/angebot", "Datum", "Firma", "Rolle"},
		{"pl/oferta", "Data", "Firma", "Rola"},
		{"pt/oferta", "Data", "Empresa", "Vaga"},
		{"da/oferta", "Dato", "Virksomhed", "Rolle"},
		{"id/lowongan", "Tanggal", "Perusahaan", "Role"},
	}
	for _, market := range markets {
		t.Run(market.mode, func(t *testing.T) {
			base := []string{"#", market.date, market.company, market.role, "Score", "Status", "PDF", "Report"}
			baseValues := []string{"41", "2026-01-02", "Acme", "Engineer", "4.2/5", "Applied", "✅", "[41](reports/041.md)"}
			pipe := func(cells []string) string { return "| " + strings.Join(cells, " | ") + " |" }
			mode, err := os.ReadFile(filepath.Join("..", "..", "..", "modes", market.mode+".md"))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(mode), pipe(base)) {
				t.Fatal("fixture must match the exact shipped mode header")
			}
			layouts := []struct {
				name           string
				headers, cells []string
			}{
				{"shipped", base, baseValues},
				{"inserted", []string{"#", market.date, market.company, "Location", "Via", market.role, "Score", "Status", "PDF", "Report", "Notes"},
					[]string{"41", "2026-01-02", "Acme", "Berlin", "Example Agency", "Engineer", "4.2/5", "Applied", "✅", "[41](reports/041.md)", "keep this note"}},
				{"reordered", []string{market.company, "Status", "#", market.date, "Location", "Via", market.role, "Score", "PDF", "Report", "Notes"},
					[]string{"Acme", "Applied", "41", "2026-01-02", "Berlin", "Example Agency", "Engineer", "4.2/5", "✅", "[41](reports/041.md)", "keep this note"}},
			}
			for _, layout := range layouts {
				t.Run(layout.name, func(t *testing.T) {
					header := pipe(layout.headers)
					cols := detectTrackerColumns([]string{header})
					if cols == nil {
						t.Fatal("localized header must not fall back to fixed positions")
					}
					tracker := header + "\n| " + strings.Repeat("--- | ", len(layout.headers)) + "\n" + pipe(layout.cells) + "\n"
					dir, trackerPath := writeTracker(t, tracker)
					apps := ParseApplications(dir)
					if len(apps) != 1 {
						t.Fatalf("expected exactly one application, got %d (header must not become a row)", len(apps))
					}
					a := apps[0]
					if a.Number != 41 || a.Date != "2026-01-02" || a.Company != "Acme" || a.Role != "Engineer" || a.ScoreRaw != "4.2/5" || a.Status != "Applied" || !a.HasPDF || a.ReportNumber != "41" {
						t.Fatalf("misaligned parsed application: %+v", a)
					}
					if layout.name == "shipped" {
						return
					}
					if a.Notes != "keep this note" || layout.cells[cols["location"]] != "Berlin" || layout.cells[cols["via"]] != "Example Agency" {
						t.Fatal("optional columns must map without shifting other values")
					}
					if err := UpdateApplicationStatusAndNotes(dir, a, "Interview", "scheduled"); err != nil {
						t.Fatal(err)
					}
					updated, err := os.ReadFile(trackerPath)
					if err != nil {
						t.Fatal(err)
					}
					want := append([]string(nil), layout.cells...)
					want[cols["status"]] = "Interview"
					want[cols["notes"]] = "keep this note scheduled"
					gotLines := strings.Split(string(updated), "\n")
					if gotLines[0] != header || !reflect.DeepEqual(splitTrackerRow(gotLines[2]), want) {
						t.Fatalf("writer changed cells outside Status/Notes:\n%s", updated)
					}
					changed := ParseApplications(dir)
					if len(changed) != 1 || changed[0].Status != "Interview" || changed[0].Notes != "keep this note scheduled" {
						t.Fatalf("writer output did not roundtrip: %+v", changed)
					}
				})
			}
		})
	}
}

func TestTrackerAliasHeaderControls(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	for _, labels := range []string{"Num | Date | Company | Role", "Num | Fecha | Empresa | Puesto", "# | Datum | Firma | Rolle"} {
		header := "| " + labels + " | Score | Status | Materials | Report | Notes |"
		row := "| 41 | 2026-01-02 | Firma | Rolle | 4.2/5 | Applied | ✅ | [41](reports/041.md) | Status |"
		dir, _ := writeTracker(t, header+"\n"+row+"\n")
		apps := ParseApplications(dir)
		if len(apps) != 1 || apps[0].Company != "Firma" || apps[0].Role != "Rolle" || apps[0].Notes != "Status" || !apps[0].HasPDF {
			t.Errorf("header %q yielded %+v", header, apps)
		}
		if detectTrackerColumns([]string{row}) != nil {
			t.Error("individual aliases in data must not satisfy the full schema")
		}
		legacy, _ := writeTracker(t, row+"\n")
		if got := ParseApplications(legacy); len(got) != 1 || got[0].Company != "Firma" || got[0].Status != "Applied" {
			t.Errorf("headerless compatibility lost: %+v", got)
		}
	}
	if detectTrackerColumns([]string{"| # | Datum | Firma | Rolle | Score | unknown | PDF | Report |"}) != nil {
		t.Error("incomplete schema must not qualify as a header")
	}
	ort := detectTrackerColumns([]string{"| # | Datum | Firma | Ort | Rolle | Score | Status | PDF | Report |"})
	if ort == nil || ort["location"] != 3 || ort["role"] != 4 {
		t.Errorf("German Ort reproduction: unexpected column map %v", ort)
	}
}

func TestTrackerSeparatorRows(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	for _, cell := range []string{"---", " --- ", " :--- ", " ---: ", " :---: "} {
		for _, ending := range []string{"with terminal pipe", "without terminal pipe"} {
			t.Run(cell+"/"+ending, func(t *testing.T) {
				lines := strings.Split(strings.Replace(insertedColumnTracker, "hot lead", "hot --- lead", 1), "\n")
				for i, line := range lines {
					if strings.HasPrefix(line, "|---") {
						lines[i] = "|" + strings.Repeat(cell+"|", len(splitTrackerRow(line)))
						if ending == "without terminal pipe" {
							lines[i] = strings.TrimSuffix(lines[i], "|")
						}
					}
				}
				dir, _ := writeTracker(t, strings.Join(lines, "\n"))
				apps := ParseApplications(dir)
				if len(apps) != 1 || apps[0].Company != "Acme" || apps[0].Notes != "hot --- lead" {
					t.Fatalf("separator must be skipped while data containing --- survives: %+v", apps)
				}
			})
		}
	}
}
