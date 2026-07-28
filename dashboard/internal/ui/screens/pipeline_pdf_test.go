package screens

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func keyMsg(s string) tea.KeyMsg {
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
}

func newPDFTestModel(t *testing.T, careerOpsPath string, apps []model.CareerApplication) PipelineModel {
	t.Helper()
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		apps,
		model.PipelineMetrics{Total: len(apps)},
		careerOpsPath,
		120,
		40,
	)
	pm.viewMode = "flat"
	pm.applyFilterAndSort()
	return pm
}

func writePDFFixture(t *testing.T, root, rel string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(full, []byte("pdf"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func TestPDFKeyFlashesWhenNoPDFExists(t *testing.T) {
	root := t.TempDir()
	apps := []model.CareerApplication{
		{Company: "Globex", Role: "Engineer", Status: "Evaluated", Score: 4.0},
	}

	pm := newPDFTestModel(t, root, apps)
	updated, cmd := pm.Update(keyMsg("d"))

	if cmd != nil {
		t.Fatal("expected no command when no PDF matches")
	}
	if updated.flash == "" {
		t.Fatal("expected a flash notice when no PDF matches")
	}
	if updated.pdfPicker {
		t.Fatal("expected no picker when no PDF matches")
	}
}

func TestPDFKeyOpensSingleMatchDirectly(t *testing.T) {
	root := t.TempDir()
	writePDFFixture(t, root, "output/cv-jane-doe-globex-2026-06-05.pdf")
	apps := []model.CareerApplication{
		{Company: "Globex", Role: "Engineer", Status: "Evaluated", Score: 4.0},
	}

	pm := newPDFTestModel(t, root, apps)
	updated, cmd := pm.Update(keyMsg("d"))

	if updated.pdfPicker {
		t.Fatal("expected no picker for a single match")
	}
	if cmd == nil {
		t.Fatal("expected an open command for a single match")
	}
	msg, ok := cmd().(PipelineOpenPDFMsg)
	if !ok {
		t.Fatalf("expected PipelineOpenPDFMsg, got %T", cmd())
	}
	if !strings.HasSuffix(msg.Path, "cv-jane-doe-globex-2026-06-05.pdf") {
		t.Fatalf("unexpected PDF path %q", msg.Path)
	}
}

func TestPDFKeyOpensNewestForMultipleMatches(t *testing.T) {
	root := t.TempDir()
	// Write two PDFs for the same company with distinct dates so ordering is predictable.
	writePDFFixture(t, root, "output/cv-jane-doe-anthropic-2026-06-05.pdf")
	writePDFFixture(t, root, "output/cv-jane-doe-anthropic-2026-06-10.pdf")
	apps := []model.CareerApplication{
		{Company: "Anthropic", Role: "Staff UI Engineer", Status: "Evaluated", Score: 4.6},
	}

	pm := newPDFTestModel(t, root, apps)
	updated, cmd := pm.Update(keyMsg("d"))

	// Multiple candidates → open the newest one immediately, no picker.
	if updated.pdfPicker {
		t.Fatal("expected no picker — newest match should be opened directly")
	}
	if cmd == nil {
		t.Fatal("expected an open command for the newest match")
	}
	msg, ok := cmd().(PipelineOpenPDFMsg)
	if !ok {
		t.Fatalf("expected PipelineOpenPDFMsg, got %T", cmd())
	}
	if !strings.HasSuffix(msg.Path, "cv-jane-doe-anthropic-2026-06-10.pdf") {
		t.Fatalf("expected newest PDF to be opened, got %q", msg.Path)
	}
}

func TestRegenerateKeyFlashesWithoutManifestEntry(t *testing.T) {
	root := t.TempDir()
	apps := []model.CareerApplication{
		{Company: "Globex", Role: "Engineer", Status: "Evaluated", Score: 4.0, ReportNumber: "001"},
	}

	pm := newPDFTestModel(t, root, apps)
	updated, cmd := pm.Update(keyMsg("D"))

	if cmd != nil {
		t.Fatal("expected no command without a manifest entry")
	}
	if updated.flash == "" {
		t.Fatal("expected a flash notice without a manifest entry")
	}
}

func TestRegenerateKeyEmitsGenerateMsgFromManifest(t *testing.T) {
	root := t.TempDir()
	writePDFFixture(t, root, "output/cv-jane-doe-globex.html")
	writePDFFixture(t, root, "data/pdf-index.tsv") // placeholder, overwritten below
	manifest := "001\toutput/cv-jane-doe-globex-2026-06-05.pdf\toutput/cv-jane-doe-globex.html\tletter\t2026-06-05\n"
	if err := os.WriteFile(filepath.Join(root, "data", "pdf-index.tsv"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	apps := []model.CareerApplication{
		{Company: "Globex", Role: "Engineer", Status: "Evaluated", Score: 4.0, ReportNumber: "001"},
	}

	pm := newPDFTestModel(t, root, apps)
	updated, cmd := pm.Update(keyMsg("D"))

	if cmd == nil {
		t.Fatal("expected a generate command")
	}
	if updated.flash == "" {
		t.Fatal("expected an in-progress flash while regenerating")
	}
	msg, ok := cmd().(PipelineGeneratePDFMsg)
	if !ok {
		t.Fatalf("expected PipelineGeneratePDFMsg, got %T", cmd())
	}
	if msg.ReportNumber != "001" || msg.HTMLPath != "output/cv-jane-doe-globex.html" || msg.Format != "letter" {
		t.Fatalf("unexpected generate request: %+v", msg)
	}

	// Outcome message updates the flash.
	done, _ := updated.Update(PipelinePDFGeneratedMsg{Path: "/abs/cv.pdf"})
	if !strings.Contains(done.flash, "cv.pdf") {
		t.Fatalf("expected success flash to name the PDF, got %q", done.flash)
	}
	failed, _ := updated.Update(PipelinePDFGeneratedMsg{Err: "node not found"})
	if !strings.Contains(failed.flash, "node not found") {
		t.Fatalf("expected failure flash to carry the error, got %q", failed.flash)
	}
}
