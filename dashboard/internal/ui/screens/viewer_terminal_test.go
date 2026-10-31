package screens

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestViewerDropsTerminalControlsFromReportText(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "report.md")
	body := "Hello " + string(rune(0x1b)) + "[2J world\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	title := "Fernhollow" + string(rune(0x1b)) + "[2J"
	m := NewViewerModel(theme.NewTheme(""), dir, path, title, 80, 24, model.CareerApplication{})
	view := m.View()
	if strings.Contains(view, "\x1b[2J") {
		t.Fatalf("viewer passed an injected clear sequence through: %q", view)
	}
	if !strings.Contains(view, "Hello") || !strings.Contains(view, "world") {
		t.Fatalf("viewer dropped the report text: %q", view)
	}
	if strings.Contains(m.title, "\x1b") {
		t.Fatalf("title kept an escape: %q", m.title)
	}
}
