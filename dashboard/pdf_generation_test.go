//go:build darwin || linux

package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
		// What generate-pdf.mjs leaves at the PDF path (os.Args[3]) decides
		// the dashboard's verdict, so the stand-in writes the way it does: a
		// PDF, or, over a warn-only page budget, a sibling draft and the two
		// stderr lines naming it, with exit 0 and the PDF path untouched (#6377).
		if len(os.Args) >= 4 {
			pdfPath := os.Args[3]
			_ = os.MkdirAll(filepath.Dir(pdfPath), 0o755)
			if os.Getenv("CAREER_OPS_TEST_PDF_OVERFLOW") == "1" {
				draft := strings.TrimSuffix(pdfPath, ".pdf") + ".overflow.pdf"
				_ = os.WriteFile(draft, []byte("%PDF draft"), 0o644)
				_, _ = os.Stderr.WriteString("⚠️  CV is 2 pages; the allowed maximum is 1 page. Trim lower-priority bullets, older roles, secondary projects, or the competencies strip, then regenerate. Overflow is warning-only by default; use --strict-pages to reject it.\n")
				_, _ = os.Stderr.WriteString("⚠️  Overflow draft: " + draft + " (nothing was written to the output path). Trim and rerun to write " + pdfPath + ".\n")
			} else {
				_ = os.WriteFile(pdfPath, []byte("%PDF"), 0o644)
			}
		}
		os.Exit(0)
	}
}

// fakeNode puts a copy of this test executable on PATH as `node`, so
// runGeneratePDF spawns it in place of generate-pdf.mjs, and swaps the
// opener for one that records what would have been opened.
func fakeNode(t *testing.T) (opened *string) {
	t.Helper()
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
	t.Setenv("CAREER_OPS_TEST_PDF_CAPTURE", filepath.Join(t.TempDir(), "capture.json"))
	previous := runOpenCommand
	t.Cleanup(func() { runOpenCommand = previous })
	var target string
	runOpenCommand = func(name string, args ...string) error {
		target = args[0]
		return nil
	}
	return &target
}

func TestRunGeneratePDFOverflowWithPreviousPDFIsNotGenerated(t *testing.T) {
	// A re-render that ran over the page budget leaves the previous PDF in
	// place. Opening it as "generated" would show the old CV as the new one.
	root := t.TempDir()
	opened := fakeNode(t)
	t.Setenv("CAREER_OPS_TEST_PDF_OVERFLOW", "1")
	previousPDF := filepath.Join(root, "output", "cv-acme.pdf")
	if err := os.MkdirAll(filepath.Dir(previousPDF), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(previousPDF, []byte("%PDF previous"), 0o644); err != nil {
		t.Fatal(err)
	}
	msg := runGeneratePDF(screens.PipelineGeneratePDFMsg{CareerOpsPath: root, HTMLPath: "output/cv-acme.html", PDFPath: "output/cv-acme.pdf", ReportNumber: "007"})().(screens.PipelinePDFGeneratedMsg)
	if msg.Path != "" || *opened != "" {
		t.Fatalf("an overflow must not open the previous PDF: %+v (opened %q)", msg, *opened)
	}
	if !strings.HasPrefix(msg.Err, "CV is 2 pages; the allowed maximum is 1 page. No PDF was written; the over-budget draft is cv-acme.overflow.pdf.") {
		t.Fatalf("help-bar line must lead with the page counts and name the draft, got %q", msg.Err)
	}
	if got, _ := os.ReadFile(previousPDF); string(got) != "%PDF previous" {
		t.Fatalf("the previous PDF must be left as it was, got %q", got)
	}
}

func TestRunGeneratePDFOverflowWithNoPDFIsNotGenerated(t *testing.T) {
	// A first render over the budget leaves nothing at the PDF path. Before
	// this check the dashboard reported "PDF generated but could not open".
	root := t.TempDir()
	opened := fakeNode(t)
	t.Setenv("CAREER_OPS_TEST_PDF_OVERFLOW", "1")
	msg := runGeneratePDF(screens.PipelineGeneratePDFMsg{CareerOpsPath: root, HTMLPath: "output/cv-acme.html", PDFPath: "output/cv-acme.pdf", ReportNumber: "007"})().(screens.PipelinePDFGeneratedMsg)
	if msg.Path != "" || *opened != "" {
		t.Fatalf("nothing to open after an overflow: %+v (opened %q)", msg, *opened)
	}
	if !strings.Contains(msg.Err, "No PDF was written; the over-budget draft is cv-acme.overflow.pdf.") {
		t.Fatalf("got %q", msg.Err)
	}
	if _, err := os.Stat(filepath.Join(root, "output", "cv-acme.pdf")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("no PDF must appear at the output path, stat err: %v", err)
	}
}

func TestPDFWrittenBetweenSeesAReplacementByIdentity(t *testing.T) {
	// A rerender of the same size inside one timestamp tick is still a new
	// file: generate-pdf.mjs renames a temp file into place.
	dir := t.TempDir()
	first := filepath.Join(dir, "a.pdf")
	second := filepath.Join(dir, "b.pdf")
	for _, name := range []string{first, second} {
		if err := os.WriteFile(name, []byte("%PDF same size"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	stamp := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	for _, name := range []string{first, second} {
		if err := os.Chtimes(name, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	before, _ := os.Stat(first)
	after, _ := os.Stat(second)
	if !pdfWrittenBetween(before, after) {
		t.Fatal("a different file with equal size and mtime is a replacement")
	}
	again, _ := os.Stat(first)
	if pdfWrittenBetween(before, again) {
		t.Fatal("the same untouched file is not a delivery")
	}
}

func TestSummarizeUndeliveredWithoutBudgetLines(t *testing.T) {
	got := summarizeUndelivered([]byte("some other output\n"), "/tmp/x/cv-acme.pdf")
	if got != "generate-pdf.mjs reported success but wrote nothing to cv-acme.pdf" {
		t.Fatalf("got %q", got)
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
