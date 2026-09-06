package data

import (
	"github.com/santifer/career-ops/dashboard/internal/model"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const statusTargetHeader = "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n"
const statusTargetRow = "| 42 | 2026-09-01 | Example Co | Engineer | 4.2/5 | Applied | ❌ | [7](reports/007.md) | original |\n"

func writeStatusTarget(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
func assertStatusTargetBytes(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Fatalf("unexpected tracker:\ngot: %s\nwant: %s", got, want)
	}
}
func TestStatusTargetUsesReaderPath(t *testing.T) {
	for _, layout := range []string{"canonical", "legacy", "both", "absolute", "relative", "missing-override"} {
		t.Run(layout, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", "")
			t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
			root := t.TempDir()
			canonical := filepath.Join(root, "data", "applications.md")
			legacy := filepath.Join(root, "applications.md")
			selected := canonical
			before := statusTargetHeader + statusTargetRow
			decoys := []string{}
			switch layout {
			case "legacy":
				selected = legacy
			case "both":
				decoys = append(decoys, legacy)
			case "absolute", "relative", "missing-override":
				selected = filepath.Join(root, "custom", "tracker.md")
				override := selected
				if layout == "relative" {
					writeStatusTarget(t, filepath.Join(root, "path-resolver.mjs"), "")
					cwd, err := os.Getwd()
					if err != nil {
						t.Fatal(err)
					}
					if err := os.Chdir(root); err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() {
						if err := os.Chdir(cwd); err != nil {
							t.Error(err)
						}
					})
					override = filepath.Join("custom", "tracker.md")
				}
				t.Setenv("CAREER_OPS_TRACKER", override)
				decoys = append(decoys, canonical, legacy)
			}
			for _, p := range decoys {
				writeStatusTarget(t, p, before)
			}
			if layout != "missing-override" {
				writeStatusTarget(t, selected, before)
			}
			app := model.CareerApplication{Number: 42, ReportNumber: "7", Status: "Applied"}
			if layout != "missing-override" {
				apps := ParseApplications(root)
				if len(apps) != 1 || apps[0].Number != 42 {
					t.Fatalf("wrong reader target: %+v", apps)
				}
				app = apps[0]
			}
			err := UpdateApplicationStatusAndNotes(root, app, "Interview", "follow-up")
			if layout == "missing-override" {
				if err == nil {
					t.Fatal("missing override must fail without fallback")
				}
				if _, err := os.Stat(selected); !os.IsNotExist(err) {
					t.Fatalf("missing tracker created: %v", err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				want := strings.Replace(before, "| Applied |", "| Interview |", 1)
				want = strings.Replace(want, "| original |", "| original follow-up |", 1)
				assertStatusTargetBytes(t, selected, want)
			}
			for _, p := range decoys {
				assertStatusTargetBytes(t, p, before)
			}
		})
	}
}
func TestStatusTargetUsesOnlyReportColumn(t *testing.T) {
	for _, tc := range []struct {
		name, other, id string
		fail            bool
	}{
		{"notes-reference", "| 6 | 2026-09-01 | Other Co | Engineer | 4.2/5 | Applied | ❌ | [6](reports/006.md) | see [7] and [7](reports/007.md) |\n", "7", false},
		{"duplicate-report", strings.Replace(statusTargetRow, "| 42 |", "| 99 |", 1), "7", true},
		{"missing-report", "", "88", true},
		{"empty-report", "", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", "")
			root, path := writeTracker(t, statusTargetHeader+tc.other+statusTargetRow)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			err = UpdateApplicationStatus(root, model.CareerApplication{Number: 42, ReportNumber: tc.id, Status: "Applied"}, "Interview")
			if tc.fail {
				if err == nil {
					t.Fatal("ambiguous/missing identity must fail")
				}
				assertStatusTargetBytes(t, path, string(before))
			} else {
				if err != nil {
					t.Fatal(err)
				}
				assertStatusTargetBytes(t, path, statusTargetHeader+tc.other+strings.Replace(statusTargetRow, "| Applied |", "| Interview |", 1))
			}
		})
	}
}
func TestStatusTargetStaleStatusNeverMatchesAnotherCell(t *testing.T) {
	for _, format := range []string{"pipe", "tabs", "tabs-status-last"} {
		t.Run(format, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", "")
			header := "| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |\n"
			row := "| 42 | 2026-09-01 | Applied | Agency | Engineer | 4.2/5 | Responded | ❌ | [7](reports/007.md) | Applied |\n"
			if format == "tabs-status-last" {
				header = "| # | Date | Company | Via | Role | Score | PDF | Report | Notes | Status |\n"
				row = "| 42 | 2026-09-01 | Applied | Agency | Engineer | 4.2/5 | ❌ | [7](reports/007.md) | Applied | Responded |\n"
			}
			if strings.HasPrefix(format, "tabs") {
				row = strings.ReplaceAll(row, " | ", "\t")
			}
			root, path := writeTracker(t, header+row)
			err := UpdateApplicationStatusAndNotes(root, model.CareerApplication{ReportNumber: "7", Status: "Applied"}, "Interview", "follow-up")
			if err != nil {
				t.Fatal(err)
			}
			apps := ParseApplications(root)
			if len(apps) != 1 || apps[0].Status != "Interview" || apps[0].Company != "Applied" || apps[0].Notes != "Applied follow-up" {
				t.Fatalf("wrong fields: %+v", apps)
			}
			out, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			want := strings.Replace(row, "Responded", "Interview", 1)
			if format == "pipe" {
				want = strings.Replace(want, "| Applied |\n", "| Applied follow-up |\n", 1)
			} else if format == "tabs-status-last" {
				want = strings.Replace(want, "\tApplied\tInterview", "\tApplied follow-up\tInterview", 1)
			} else {
				want = strings.Replace(want, "\tApplied |\n", "\tApplied follow-up |\n", 1)
			}
			if string(out) != header+want {
				t.Fatalf("unexpected replacement: %s; want %s", out, header+want)
			}
		})
	}
}
func TestStatusTargetRejectsMalformedStatusAndUnsafeNotes(t *testing.T) {
	for _, tc := range []struct{ name, status, notes string }{
		{"unknown-current-status", "???", ""},
		{"empty-current-status", "", ""},
		{"carriage-return-note", "Applied", "line1\rline2"},
		{"pipe-note", "Applied", "DISCARD: salary | location"},
		{"newline-note", "Applied", "line1\nline2"},
		{"tab-note", "Applied", "line1\tline2"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", "")
			row := strings.Replace(statusTargetRow, "| Applied |", "| "+tc.status+" |", 1)
			row = strings.Replace(row, "| original |", "| Applied |", 1)
			root, path := writeTracker(t, statusTargetHeader+row)
			err := UpdateApplicationStatusAndNotes(root, model.CareerApplication{ReportNumber: "7", Status: "Applied"}, "Interview", tc.notes)
			if err == nil {
				t.Fatal("invalid update must fail")
			}
			assertStatusTargetBytes(t, path, statusTargetHeader+row)
		})
	}
}

func TestStatusTargetRejectsInvalidNewStatus(t *testing.T) {
	for _, status := range []string{"", "???", "Applied | Interview", "Applied\nInterview"} {
		t.Run(status, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", "")
			before := statusTargetHeader + statusTargetRow
			root, path := writeTracker(t, before)
			if err := UpdateApplicationStatus(root, model.CareerApplication{ReportNumber: "7", Status: "Applied"}, status); err == nil {
				t.Fatal("invalid status must fail")
			}
			assertStatusTargetBytes(t, path, before)
		})
	}
}

func TestStatusTargetRejectsOutOfBoundsMappedCell(t *testing.T) {
	for _, index := range []int{-1, 9, 100} {
		line := strings.TrimSuffix(statusTargetRow, "\n")
		if got, ok := replaceStatusInLine(line, "Interview", index); ok || got != line {
			t.Fatalf("index %d changed row: %s", index, got)
		}
	}
}

func TestStatusTargetRejectsMissingNotesCell(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	row := strings.Replace(statusTargetRow, " original |", "", 1)
	before := statusTargetHeader + row
	root, path := writeTracker(t, before)
	err := UpdateApplicationStatusAndNotes(root, model.CareerApplication{ReportNumber: "7", Status: "Applied"}, "Interview", "follow-up")
	if err == nil {
		t.Fatal("missing Notes cell must fail without appending outside the table")
	}
	assertStatusTargetBytes(t, path, before)
}

func TestStatusTargetAppendsToCompactEmptyNotes(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	row := strings.Replace(statusTargetRow, "| original |", "||", 1)
	root, path := writeTracker(t, statusTargetHeader+row)
	err := UpdateApplicationStatusAndNotes(root, model.CareerApplication{ReportNumber: "7", Status: "Applied"}, "Interview", "follow-up")
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(row, "| Applied |", "| Interview |", 1)
	want = strings.Replace(want, "||", "| follow-up |", 1)
	assertStatusTargetBytes(t, path, statusTargetHeader+want)
}
