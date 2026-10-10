//go:build darwin || linux

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

type pdfNodeCapture struct {
	Args    []string
	Dir     string
	Root    string
	Tracker string
	Index   string
}

// A copy of this test executable serves as node, so the regression exercises
// real process arguments/environment without Chromium or a shell fixture.
func init() {
	if capture := os.Getenv("CAREER_OPS_TEST_PDF_CAPTURE"); capture != "" {
		cwd, _ := os.Getwd()
		payload, _ := json.Marshal(pdfNodeCapture{os.Args[1:], cwd,
			os.Getenv("CAREER_OPS_ROOT"), os.Getenv("CAREER_OPS_TRACKER"), os.Getenv("CAREER_OPS_PDF_INDEX")})
		if err := os.WriteFile(capture, payload, 0o600); err != nil {
			os.Exit(1)
		}
		if len(os.Args) < 2 || !filepath.IsAbs(os.Args[1]) {
			os.Stderr.WriteString("generator script must be resolved from the checkout\n")
			os.Exit(1)
		}
		os.Exit(0)
	}
}

func TestRunGeneratePDFUsesCheckoutWithSelectedDataRoot(t *testing.T) {
	checkout := getRepoRoot()
	root := t.TempDir()
	capture := filepath.Join(t.TempDir(), "capture.json")
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	binDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(binDir, "node"), binary, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("CAREER_OPS_TEST_PDF_CAPTURE", capture)
	t.Setenv("CAREER_OPS_ROOT", t.TempDir()) // --path must win over an inherited root
	t.Setenv("CAREER_OPS_TRACKER", "custom/tracker.md")
	t.Setenv("CAREER_OPS_PDF_INDEX", "custom-index.tsv")
	previous := runOpenCommand
	t.Cleanup(func() { runOpenCommand = previous })
	var opened string
	runOpenCommand = func(name string, args ...string) error {
		opened = args[0]
		return nil
	}
	request := screens.PipelineGeneratePDFMsg{
		CareerOpsPath: root, HTMLPath: "output/source CV.html", PDFPath: "output/tailored CV.pdf", Format: "a4", ReportNumber: "007",
	}
	msg := runGeneratePDF(request)().(screens.PipelinePDFGeneratedMsg)
	if msg.Err != "" {
		t.Fatalf("PDF generation failed: %s", msg.Err)
	}
	var got pdfNodeCapture
	raw, err := os.ReadFile(capture)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	wantArgs := []string{filepath.Join(checkout, "generate-pdf.mjs"), filepath.Join(root, request.HTMLPath), filepath.Join(root, request.PDFPath), "--format=a4", "--report=007"}
	if len(got.Args) != len(wantArgs) {
		t.Fatalf("unexpected args: %v", got.Args)
	}
	for i, want := range wantArgs {
		if got.Args[i] != want {
			t.Fatalf("argument %d = %q, want %q", i, got.Args[i], want)
		}
	}
	index, _ := filepath.Abs("custom-index.tsv")
	if got.Root != root || got.Tracker != filepath.Join(checkout, "custom", "tracker.md") || got.Index != index {
		t.Fatalf("child selected another workspace: %+v", got)
	}
	if got.Dir != checkout {
		t.Fatalf("child cwd = %s, want checkout %s", got.Dir, checkout)
	}
	if opened != filepath.Join(root, request.PDFPath) || msg.Path != opened {
		t.Fatalf("opened wrong PDF: %s, result %+v", opened, msg)
	}
}

func TestRunGeneratePDFRejectsDataOnlyScript(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "generate-pdf.mjs"), []byte("throw new Error('data script ran')"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Chdir(root)
	msg := runGeneratePDF(screens.PipelineGeneratePDFMsg{CareerOpsPath: root})().(screens.PipelinePDFGeneratedMsg)
	if !strings.Contains(msg.Err, "need generate-pdf.mjs in the career-ops checkout") {
		t.Fatalf("data-only script must not run: %+v", msg)
	}
}
