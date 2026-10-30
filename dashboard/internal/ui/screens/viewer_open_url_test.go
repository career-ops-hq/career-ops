package screens

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func viewerKey(s string) tea.KeyMsg {
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
}

func TestResolveJobURLPrefersTrackerURL(t *testing.T) {
	app := model.CareerApplication{JobURL: "https://tracker.example.com/job/1"}
	lines := []string{"**URL:** https://report.example.com/job/1"}

	if got := resolveJobURL(app, lines); got != app.JobURL {
		t.Fatalf("resolveJobURL = %q, want tracker URL %q", got, app.JobURL)
	}
}

func TestResolveJobURLFallsBackToReportHeader(t *testing.T) {
	lines := []string{
		"# Evaluation: Acme — Engineer",
		"",
		"**Score:** 4.2/5",
		"**URL:** https://jobs.example.com/acme/123",
		"**PDF:** ❌",
	}

	if got := resolveJobURL(model.CareerApplication{}, lines); got != "https://jobs.example.com/acme/123" {
		t.Fatalf("resolveJobURL = %q, want the report's **URL:** header", got)
	}
}

func TestResolveJobURLIgnoresNonHTTPHeader(t *testing.T) {
	lines := []string{"**URL:** local:jds/acme-engineer.md"}

	if got := resolveJobURL(model.CareerApplication{}, lines); got != "" {
		t.Fatalf("resolveJobURL = %q, want empty for a non-http URL", got)
	}
}

func TestResolveJobURLRejectsHostlessURLs(t *testing.T) {
	app := model.CareerApplication{JobURL: "https://?x"}
	lines := []string{"**URL:** https://", "**URL:** https://?ref=1"}

	if got := resolveJobURL(app, lines); got != "" {
		t.Fatalf("resolveJobURL = %q, want empty for hostless URLs", got)
	}
}

func TestResolveJobURLSkipsInvalidTrackerURL(t *testing.T) {
	app := model.CareerApplication{JobURL: "https://?x"}
	lines := []string{"**URL:** https://jobs.example.com/acme/123"}

	if got := resolveJobURL(app, lines); got != "https://jobs.example.com/acme/123" {
		t.Fatalf("resolveJobURL = %q, want the report header when the tracker URL is unusable", got)
	}
}

func TestResolveJobURLSkipsInvalidHeaderForLaterValidOne(t *testing.T) {
	lines := []string{
		"**URL:** local:jds/acme-engineer.md",
		"**URL:** https://",
		"**URL:** HTTPS://jobs.example.com/acme/123",
	}

	if got := resolveJobURL(model.CareerApplication{}, lines); got != "HTTPS://jobs.example.com/acme/123" {
		t.Fatalf("resolveJobURL = %q, want the first usable header", got)
	}
}

func TestNewViewerModelReadsURLFromReport(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "001-acme-2026-01-01.md")
	report := "# Evaluation: Acme\n\n**URL:** https://jobs.example.com/acme/123\n"
	if err := os.WriteFile(path, []byte(report), 0o644); err != nil {
		t.Fatal(err)
	}

	m := NewViewerModel(theme.NewTheme("catppuccin-mocha"), dir, path, "Acme", 80, 20, model.CareerApplication{})

	if m.jobURL != "https://jobs.example.com/acme/123" {
		t.Fatalf("jobURL = %q, want the report's **URL:** header", m.jobURL)
	}
}

func TestViewerOpenURLKeyEmitsOpenMsg(t *testing.T) {
	m := ViewerModel{jobURL: "https://jobs.example.com/acme/123", theme: theme.NewTheme("catppuccin-mocha")}

	_, cmd := m.Update(viewerKey("o"))
	if cmd == nil {
		t.Fatal("expected a command for `o` when the report has a URL")
	}
	msg, ok := cmd().(PipelineOpenURLMsg)
	if !ok {
		t.Fatalf("expected PipelineOpenURLMsg, got %T", cmd())
	}
	if msg.URL != "https://jobs.example.com/acme/123" {
		t.Fatalf("URL = %q, want the report URL", msg.URL)
	}
}

func TestViewerOpenURLKeyWithoutURLFlashes(t *testing.T) {
	m := ViewerModel{theme: theme.NewTheme("catppuccin-mocha")}

	updated, cmd := m.Update(viewerKey("o"))
	if cmd != nil {
		t.Fatalf("expected no command without a URL, got %T", cmd())
	}
	if !strings.Contains(updated.flash, "No URL found") {
		t.Fatalf("expected a no-URL flash, got %q", updated.flash)
	}
}

func TestViewerFooterShowsOpenURLHintOnlyWithURL(t *testing.T) {
	base := ViewerModel{width: 200, height: 20, theme: theme.NewTheme("catppuccin-mocha")}
	withURL := base
	withURL.jobURL = "https://jobs.example.com/acme/123"

	if footer := ansi.Strip(base.renderFooter()); strings.Contains(footer, "open URL") {
		t.Fatalf("expected no open-URL hint without a URL, got %q", footer)
	}
	if footer := ansi.Strip(withURL.renderFooter()); !strings.Contains(footer, "open URL") {
		t.Fatalf("expected open-URL hint with a URL, got %q", footer)
	}
}

// Issue 3913: main.go routes PipelineOpenFailedMsg to the active screen, so the
// viewer must surface it itself; the pipeline's flash line is not on screen.
func TestViewerOpenFailedMsgSetsFlashUntilNextKey(t *testing.T) {
	m := ViewerModel{width: 200, height: 20, theme: theme.NewTheme("catppuccin-mocha")}

	failed, _ := m.Update(PipelineOpenFailedMsg{
		Target: "https://jobs.example.com/acme/123",
		Err:    "executable file not found in $PATH",
	})
	footer := ansi.Strip(failed.renderFooter())
	if !strings.Contains(footer, "executable file not found in $PATH") {
		t.Fatalf("expected footer to show the open failure, got %q", footer)
	}

	cleared, _ := failed.Update(viewerKey("j"))
	if cleared.flash != "" {
		t.Fatalf("expected the next key press to clear the flash, got %q", cleared.flash)
	}
}
