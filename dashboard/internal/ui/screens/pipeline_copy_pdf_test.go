package screens

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/model"
)

// Issue 6036: `y` copies the selected application's newest CV PDF path.

func TestCopyPDFKeyEmitsNewestPDFPath(t *testing.T) {
	root := t.TempDir()
	writePDFFixture(t, root, "output/cv-jane-doe-globex-2026-06-01.pdf")
	writePDFFixture(t, root, "output/cv-jane-doe-globex-2026-06-05.pdf")
	apps := []model.CareerApplication{
		{Company: "Globex", Role: "Engineer", Status: "Evaluated", Score: 4.0, HasScore: true},
	}
	pm := newPDFTestModel(t, root, apps)

	// Same resolver as `d`: the copied path must be what `d` would open.
	app, _ := pm.CurrentApp()
	rel, ok := pm.newestPDF(app)
	if !ok {
		t.Fatal("expected a resolved PDF")
	}
	want := filepath.Join(data.PDFWorkspaceRoot(root), filepath.FromSlash(rel))

	_, cmd := pm.Update(keyMsg("y"))
	if cmd == nil {
		t.Fatal("expected a copy command")
	}
	msg, ok := cmd().(PipelineCopyPDFPathMsg)
	if !ok {
		t.Fatalf("expected PipelineCopyPDFPathMsg, got %T", cmd())
	}
	if msg.Path != want {
		t.Fatalf("path = %q, want %q", msg.Path, want)
	}
	if !strings.HasSuffix(msg.Path, "cv-jane-doe-globex-2026-06-05.pdf") {
		t.Fatalf("expected newest PDF, got %q", msg.Path)
	}

	_, dcmd := pm.Update(keyMsg("d"))
	open, ok := dcmd().(PipelineOpenPDFMsg)
	if !ok || open.Path != msg.Path {
		t.Fatalf("`d` and `y` disagree: d=%#v y=%q", open, msg.Path)
	}
}

func TestCopyPDFKeyPathIsAbsoluteWithRelativeCareerOpsPath(t *testing.T) {
	root := t.TempDir()
	writePDFFixture(t, root, "output/cv-jane-doe-globex-2026-06-05.pdf")
	t.Chdir(filepath.Dir(root))
	apps := []model.CareerApplication{
		{Company: "Globex", Role: "Engineer", Status: "Evaluated", Score: 4.0, HasScore: true},
	}
	// --path accepts a relative directory; the clipboard must still get an
	// absolute path, since it is pasted into other apps.
	pm := newPDFTestModel(t, filepath.Base(root), apps)

	_, cmd := pm.Update(keyMsg("y"))
	if cmd == nil {
		t.Fatal("expected a copy command")
	}
	msg, ok := cmd().(PipelineCopyPDFPathMsg)
	if !ok {
		t.Fatalf("expected PipelineCopyPDFPathMsg, got %T", cmd())
	}
	if !filepath.IsAbs(msg.Path) {
		t.Fatalf("copied path %q is not absolute", msg.Path)
	}
	if !strings.HasSuffix(msg.Path, filepath.Join("output", "cv-jane-doe-globex-2026-06-05.pdf")) {
		t.Fatalf("unexpected path %q", msg.Path)
	}
}

func TestCopyPDFKeyNoPDFUsesSameFlashAsOpen(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Globex", Role: "Engineer", Status: "Evaluated", Score: 4.0, HasScore: true},
	}
	pm := newPDFTestModel(t, t.TempDir(), apps)

	y, ycmd := pm.Update(keyMsg("y"))
	d, _ := pm.Update(keyMsg("d"))
	if ycmd != nil {
		t.Fatal("expected no command when no PDF exists")
	}
	if y.flash == "" || y.flash != d.flash {
		t.Fatalf("y flash %q should equal d flash %q", y.flash, d.flash)
	}
}

func TestClipboardResultFlashes(t *testing.T) {
	pm := newPDFTestModel(t, t.TempDir(), nil)

	ok, _ := pm.Update(PipelineClipboardResultMsg{Path: "/out/cv.pdf"})
	if !strings.Contains(ok.flash, "Copied") || !strings.Contains(ok.flash, "/out/cv.pdf") {
		t.Fatalf("unexpected success flash %q", ok.flash)
	}

	failed, _ := pm.Update(PipelineClipboardResultMsg{Path: "/out/cv.pdf", Err: "no clipboard utility found"})
	if strings.Contains(failed.flash, "Copied") || !strings.Contains(failed.flash, "no clipboard utility found") {
		t.Fatalf("failure must not report success, got %q", failed.flash)
	}
}
