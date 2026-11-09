package screens

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

func TestPDFKeysKeepCVWhenCoverWasGeneratedLater(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_PDF_INDEX", "")
	root := t.TempDir()
	pdf, html := "output/resume-acme.pdf", "output/resume-acme.html"
	writePDFFixture(t, root, pdf)
	writePDFFixture(t, root, html)
	writePDFFixture(t, root, "output/cover-acme.pdf")
	writePDFFixture(t, root, "output/cover-acme.html")
	writePDFFixture(t, root, "data/pdf-index.tsv")
	manifest := "7\t" + pdf + "\t" + html + "\tletter\t2026-09-01\tcv\n" +
		"7\toutput/cover-acme.pdf\toutput/cover-acme.html\tletter\t2026-09-02\tcover\n"
	if err := os.WriteFile(filepath.Join(root, "data", "pdf-index.tsv"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	pm := newPDFTestModel(t, root, []model.CareerApplication{{Company: "Acme", ReportNumber: "7", Status: "Evaluated", Score: 4, HasScore: true}})
	_, cmd := pm.Update(keyMsg("d"))
	if cmd == nil {
		t.Fatal("expected CV open command")
	}
	if got := cmd().(PipelineOpenPDFMsg).Path; got != filepath.Join(root, filepath.FromSlash(pdf)) {
		t.Fatalf("opened cover instead of CV: %s", got)
	}
	_, cmd = pm.Update(keyMsg("D"))
	if cmd == nil {
		t.Fatal("expected CV generation command")
	}
	if got := cmd().(PipelineGeneratePDFMsg); got.PDFPath != pdf || got.HTMLPath != html {
		t.Fatalf("regenerated cover instead of CV: %+v", got)
	}
}
