package data

import "testing"

func TestPDFManifestReadersExcludeCoverLetters(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER", "")
	t.Setenv("CAREER_OPS_PDF_INDEX", "")
	root := t.TempDir()
	writeFixture(t, root, "data/pdf-index.tsv",
		"7\toutput/cv-acme.pdf\toutput/cv-acme.html\tletter\t2026-09-01\tcv\n"+
			"007\toutput/cover-acme.pdf\toutput/cover-acme.html\tletter\t2026-09-02\tcover\n"+
			"8\toutput/cover-only.pdf\toutput/cover-only.html\tletter\t2026-09-02\tcover\n"+
			"9\toutput/cv-legacy.pdf\toutput/cv-legacy.html\tletter\t2026-09-01\n"+
			"\toutput/cover-unlinked.pdf\toutput/cover-unlinked.html\tletter\t2026-09-02\tcover\n"+
			"\toutput/cv-unlinked.pdf\toutput/cv-unlinked.html\tletter\t2026-09-01\tcv\n")
	manifest := LoadPDFManifest(root)
	if got := manifest["7"].PDFPath; got != "output/cv-acme.pdf" {
		t.Fatalf("cover replaced CV: %q", got)
	}
	if _, ok := manifest["8"]; ok {
		t.Fatal("cover-only report must not have a CV manifest entry")
	}
	if got := manifest["9"].PDFPath; got != "output/cv-legacy.pdf" {
		t.Fatalf("legacy CV row disappeared: %q", got)
	}
	byPath := LoadPDFEntriesByPath(root)
	for _, cover := range []string{"output/cover-acme.pdf", "output/cover-only.pdf", "output/cover-unlinked.pdf"} {
		if _, ok := byPath[cover]; ok {
			t.Fatalf("cover is offered as a CV regeneration source: %s", cover)
		}
	}
	for _, cv := range []string{"output/cv-acme.pdf", "output/cv-legacy.pdf", "output/cv-unlinked.pdf"} {
		if _, ok := byPath[cv]; !ok {
			t.Fatalf("CV missing from path index: %s", cv)
		}
	}
}
