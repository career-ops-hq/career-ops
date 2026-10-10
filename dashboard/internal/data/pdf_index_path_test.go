package data

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPDFIndexReadersHonorOverride(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	root := t.TempDir()
	index := filepath.Join(t.TempDir(), "custom-index.tsv")
	if err := os.WriteFile(index, []byte("7\toutput/cv-exact.pdf\toutput/cv-exact.html\tletter\t2026-09-01\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, override := range []string{index, filepath.Base(index)} {
		t.Run(override, func(t *testing.T) {
			if !filepath.IsAbs(override) {
				t.Chdir(filepath.Dir(index))
			}
			t.Setenv("CAREER_OPS_PDF_INDEX", override)
			if got := LoadPDFManifest(root); got["7"].PDFPath != "output/cv-exact.pdf" {
				t.Fatalf("override ignored: %v", got)
			}
			if got := LoadPDFEntriesByPath(root); got["output/cv-exact.pdf"].HTMLPath != "output/cv-exact.html" {
				t.Fatalf("override ignored by path reader: %v", got)
			}
		})
	}
}

func TestPDFIndexReadersFollowTrackerWorkspace(t *testing.T) {
	t.Setenv("CAREER_OPS_PDF_INDEX", "")
	root := t.TempDir()
	workspace := t.TempDir()
	writeFixture(t, workspace, "data/pdf-index.tsv", "7\toutput/cv-external.pdf\toutput/cv-external.html\tletter\t2026-09-01\n")
	writeFixture(t, root, "data/pdf-index.tsv", "7\toutput/cv-decoy.pdf\t\tletter\t2026-09-01\n")
	for _, tracker := range []string{"data/applications.md", "applications.md"} {
		t.Run(tracker, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", filepath.Join(workspace, tracker))
			if got := LoadPDFManifest(root); got["7"].PDFPath != "output/cv-external.pdf" {
				t.Fatalf("read another workspace: %v", got)
			}
			if got := LoadPDFEntriesByPath(root); got["output/cv-external.pdf"].HTMLPath != "output/cv-external.html" {
				t.Fatalf("path reader used another workspace: %v", got)
			}
		})
	}
}
