package data

import (
	"os"
	"path/filepath"
	"runtime"
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

func TestPDFIndexReadersKeepArtifactsWithSymlinkedTracker(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_PDF_INDEX", "")
	root, external := t.TempDir(), t.TempDir()
	writeFixture(t, external, "data/applications.md", "")
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(external, "data", "applications.md"), filepath.Join(root, "data", "applications.md")); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlinks unavailable: %v", err)
		}
		t.Fatal(err)
	}
	// generate-pdf.mjs stores the index beside the canonical tracker, but
	// records artifacts relative to the lexical workspace for file links too.
	pdf, html := "output/cv.pdf", "output/cv.html"
	writeFixture(t, root, pdf, "local PDF")
	writeFixture(t, external, pdf, "external decoy")
	writeFixture(t, external, "data/pdf-index.tsv", "7\t"+pdf+"\t"+html+"\tletter\t2026-10-11\tcv\n")
	entry := LoadPDFManifest(root)["7"]
	if entry.PDFPath != pdf || entry.HTMLPath != html {
		t.Fatalf("did not read canonical tracker index: %+v", entry)
	}
	if got := LoadPDFEntriesByPath(root)[pdf]; got != entry {
		t.Fatalf("path reader disagrees with report reader: %+v", got)
	}
	if got := PDFWorkspaceRoot(root); got != root {
		t.Fatalf("artifact root followed tracker file link: %s", got)
	}
	artifact, err := os.ReadFile(filepath.Join(PDFWorkspaceRoot(root), entry.PDFPath))
	if err != nil || string(artifact) != "local PDF" {
		t.Fatalf("did not resolve writer's local artifact: %q, %v", artifact, err)
	}
}
