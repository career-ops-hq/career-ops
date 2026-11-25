package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestPipelineHiredSelectionWaitsForWrite(t *testing.T) {
	m := newFlashTestModel(t)
	m.statusPicker = true
	for i, pair := range m.currentStatusPairs() {
		if pair.Canonical == "Hired" {
			m.statusCursor = i
			break
		}
	}

	pending, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if pending.hiredStep != 0 {
		t.Fatal("hired celebration started before the status writer completed")
	}
	if cmd == nil {
		t.Fatal("expected a status update command")
	}
	request, ok := cmd().(PipelineUpdateStatusMsg)
	if !ok || request.NewStatus != "Hired" {
		t.Fatalf("expected Hired write request, got %+v", request)
	}

	confirmed, _ := pending.StartHiredFlow(request.App)
	if confirmed.hiredStep != 1 {
		t.Fatal("successful write must still be able to start the celebration")
	}
}

func TestStatusUpdateFailureShowsSanitizedError(t *testing.T) {
	msg := StatusUpdateFailedMsg{Err: "tracker locked\nretry later\x1b[2J"}
	pipeline, _ := newFlashTestModel(t).Update(msg)
	viewer := ViewerModel{
		app:   model.CareerApplication{Status: "Applied"},
		width: 120, height: 40, theme: theme.NewTheme("catppuccin-mocha"),
	}
	viewer, _ = viewer.Update(msg)
	for name, output := range map[string]string{
		"pipeline": pipeline.renderHelp(),
		"viewer":   viewer.renderFooter(),
	} {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(output, "Could not update status: tracker locked retry later") {
				t.Fatalf("missing actionable error: %q", output)
			}
			if strings.Contains(output, "\x1b[2J") {
				t.Fatalf("error rendered terminal control sequence: %q", output)
			}
		})
	}
	viewer, _ = viewer.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	if viewer.flash != "" {
		t.Fatal("the next key should clear the viewer's one-shot error")
	}
}
