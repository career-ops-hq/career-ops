package main

import (
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

func TestNewAppModelStartsCommandCenterWithoutTracker(t *testing.T) {
	m := newAppModel(t.TempDir(), 100, 36)

	if m.state != viewCommand {
		t.Fatalf("expected dashboard to start on command center, got state %d", m.state)
	}
	if m.dashboardContext.NextAction.Title != "Add your CV" {
		t.Fatalf("expected empty workspace to guide CV setup, got %q", m.dashboardContext.NextAction.Title)
	}
	if !strings.Contains(m.View(), "CAREER COMMAND CENTER") {
		t.Fatalf("expected command center view, got:\n%s", m.View())
	}
}

func TestAppModelRoutesCommandCenterMessages(t *testing.T) {
	m := newAppModel(t.TempDir(), 100, 36)

	updated, _ := m.Update(screens.CommandOpenPipelineMsg{})
	pipelineModel := updated.(appModel)
	if pipelineModel.state != viewPipeline {
		t.Fatalf("expected pipeline state after command message, got %d", pipelineModel.state)
	}

	updated, _ = pipelineModel.Update(screens.PipelineOpenHomeMsg{})
	homeModel := updated.(appModel)
	if homeModel.state != viewCommand {
		t.Fatalf("expected home state after pipeline home message, got %d", homeModel.state)
	}

	updated, _ = homeModel.Update(screens.CommandOpenProgressMsg{})
	progressModel := updated.(appModel)
	if progressModel.state != viewProgress {
		t.Fatalf("expected progress state after command message, got %d", progressModel.state)
	}
}
