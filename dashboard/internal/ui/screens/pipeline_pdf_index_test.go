package screens

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

func TestPDFKeysUseSelectedIndexAndTrackerWorkspace(t *testing.T) {
	for _, layout := range []string{"index-override", "canonical-tracker", "legacy-tracker"} {
		t.Run(layout, func(t *testing.T) {
			t.Setenv("CAREER_OPS_TRACKER", "")
			t.Setenv("CAREER_OPS_PDF_INDEX", "")
			root := t.TempDir()
			workspace := root
			index := filepath.Join(root, "data", "pdf-index.tsv")
			if layout == "index-override" {
				index = filepath.Join(t.TempDir(), "custom.tsv")
				t.Setenv("CAREER_OPS_PDF_INDEX", index)
			} else {
				workspace = t.TempDir()
				tracker := "data/applications.md"
				if layout == "legacy-tracker" {
					tracker = "applications.md"
				}
				writePDFFixture(t, workspace, tracker)
				t.Setenv("CAREER_OPS_TRACKER", filepath.Join(workspace, tracker))
				index = filepath.Join(workspace, "data", "pdf-index.tsv")
			}
			pdf, html := "output/cv-exact.pdf", "output/cv-exact.html"
			writePDFFixture(t, workspace, pdf)
			writePDFFixture(t, workspace, html)
			if err := os.MkdirAll(filepath.Dir(index), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(index, []byte("7\t"+pdf+"\t"+html+"\tletter\t2026-09-01\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			apps := []model.CareerApplication{{Company: "Acme", ReportNumber: "7", Status: "Evaluated", Score: 4, HasScore: true}}
			pm := newPDFTestModel(t, root, apps)
			updated, cmd := pm.Update(keyMsg("d"))
			if cmd == nil {
				t.Fatalf("expected exact PDF open: %s", updated.flash)
			}
			opened := cmd().(PipelineOpenPDFMsg)
			if info, err := os.Stat(opened.Path); err != nil || info.IsDir() {
				t.Fatalf("opened wrong workspace PDF: %s, %v", opened.Path, err)
			}
			updated, cmd = pm.Update(keyMsg("D"))
			if cmd == nil {
				t.Fatalf("expected regeneration request: %s", updated.flash)
			}
			generated := cmd().(PipelineGeneratePDFMsg)
			if generated.HTMLPath != html || generated.PDFPath != pdf {
				t.Fatalf("wrong artifact pair: %+v", generated)
			}
			if _, err := os.Stat(filepath.Join(generated.CareerOpsPath, html)); err != nil {
				t.Fatalf("regeneration used wrong workspace: %+v, %v", generated, err)
			}
		})
	}
}

func TestPDFKeysKeepArtifactsInWorkspaceWithSymlinkedData(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_PDF_INDEX", "")
	root, external := t.TempDir(), t.TempDir()
	writePDFFixture(t, external, "data/applications.md")
	if err := os.Symlink(filepath.Join(external, "data"), filepath.Join(root, "data")); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlinks unavailable: %v", err)
		}
		t.Fatal(err)
	}
	pdf, html := "output/exact-resume.pdf", "output/exact-resume.html"
	writePDFFixture(t, root, pdf)
	writePDFFixture(t, root, html)
	// These decoys exist so canonicalizing the tracker before deriving the
	// artifact root cannot accidentally pass by merely checking file existence.
	writePDFFixture(t, external, pdf)
	writePDFFixture(t, external, html)
	index := filepath.Join(external, "data", "pdf-index.tsv")
	if err := os.WriteFile(index, []byte("7\t"+pdf+"\t"+html+"\tletter\t2026-09-01\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	pm := newPDFTestModel(t, root, []model.CareerApplication{{Company: "Acme", ReportNumber: "7", Status: "Evaluated", Score: 4, HasScore: true}})
	updated, cmd := pm.Update(keyMsg("d"))
	if cmd == nil {
		t.Fatalf("expected exact PDF from symlinked manifest: %s", updated.flash)
	}
	if got := cmd().(PipelineOpenPDFMsg).Path; got != filepath.Join(root, filepath.FromSlash(pdf)) {
		t.Fatalf("opened artifact beside the symlink target: %s", got)
	}
	updated, cmd = pm.Update(keyMsg("D"))
	if cmd == nil {
		t.Fatalf("expected regeneration request: %s", updated.flash)
	}
	if got := cmd().(PipelineGeneratePDFMsg); got.CareerOpsPath != root || got.PDFPath != pdf || got.HTMLPath != html {
		t.Fatalf("regeneration followed data symlink out of the workspace: %+v", got)
	}
}
