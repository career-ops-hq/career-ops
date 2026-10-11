package main

import (
	"errors"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

func TestRefreshPreservesMetricsWhenFunnelHistoryCannotBeRead(t *testing.T) {
	root := t.TempDir()
	tracker := filepath.Join(root, "applications.md")
	t.Setenv("CAREER_OPS_TRACKER", tracker)
	content := "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n" +
		"|---|---|---|---|---|---|---|---|---|\n" +
		"| 1 | 2026-09-01 | Example | Engineer | 4.0/5 | Responded | ❌ | | |\n"
	if err := os.WriteFile(tracker, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	ledger := filepath.Join(root, "status-log.tsv")
	if err := os.Mkdir(ledger, 0700); err != nil {
		t.Fatal(err)
	}
	apps := []model.CareerApplication{{Number: 1, Company: "Example", Role: "Engineer", Status: "Discarded", Score: 4}}
	want := data.ComputeProgressMetrics(apps, map[int]int{1: 5})
	theme := theme.NewTheme("auto")
	m := appModel{
		careerOpsPath:   root,
		theme:           theme,
		pipeline:        screens.NewPipelineModel(theme, apps, data.ComputeMetrics(apps), root, 120, 40),
		progressMetrics: want,
	}

	updated, _ := m.Update(screens.PipelineRefreshMsg{})
	m = updated.(appModel)
	if !reflect.DeepEqual(m.progressMetrics, want) {
		t.Fatalf("failed refresh replaced historical metrics: offers = %d, want %d", m.progressMetrics.TotalOffers, want.TotalOffers)
	}
	// Long Windows temp paths wrap the ledger filename across display lines.
	// Check the rendered path without layout whitespace, not the host's path length.
	if view := m.pipeline.View(); !strings.Contains(view, "Status history unavailable") || !strings.Contains(strings.Join(strings.Fields(view), ""), "status-log.tsv") {
		t.Fatalf("failed refresh did not display the ledger error: %s", view)
	}
	if app, ok := m.pipeline.CurrentApp(); !ok || app.Status != "Responded" || m.evaluatedCount != 1 {
		t.Fatalf("history failure prevented refreshing the saved tracker status: %+v", app)
	}
	updated, _ = m.Update(screens.PipelineOpenProgressMsg{})
	m = updated.(appModel)
	oldProgress := screens.NewProgressModel(theme, want, 120, 40).View()
	if m.progress.View() != oldProgress {
		t.Fatal("opening Progress after a failed refresh lost the historical metrics")
	}
	updated, _ = m.Update(screens.ProgressClosedMsg{})
	m = updated.(appModel)

	if err := os.Remove(ledger); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ledger, []byte("1\t2026-09-01\tInterview\tDiscarded\n"), 0600); err != nil {
		t.Fatal(err)
	}
	updated, _ = m.Update(screens.PipelineRefreshMsg{})
	m = updated.(appModel)
	if m.progressMetrics.TotalOffers != 0 || m.progressMetrics.FunnelStages[4].Count != 1 {
		t.Fatalf("refresh did not recover after restoring the ledger: %+v", m.progressMetrics.FunnelStages)
	}
	if strings.Contains(m.pipeline.View(), "Status history unavailable") {
		t.Fatal("successful refresh retained the previous error notice")
	}
	updated, _ = m.Update(screens.PipelineOpenProgressMsg{})
	m = updated.(appModel)
	if m.progress.View() == oldProgress {
		t.Fatal("reopening Progress after recovery still shows stale history")
	}
}

func TestStartupRejectsUnreadableFunnelHistory(t *testing.T) {
	if root := os.Getenv("CAREER_OPS_TEST_STARTUP"); root != "" {
		flag.CommandLine = flag.NewFlagSet("career-dashboard", flag.ExitOnError)
		os.Args = []string{"career-dashboard", "--path", root}
		main()
		return
	}
	root := t.TempDir()
	tracker := filepath.Join(root, "applications.md")
	if err := os.WriteFile(tracker, []byte("# Empty test tracker\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "status-log.tsv"), 0700); err != nil {
		t.Fatal(err)
	}
	testBinary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(testBinary, "-test.run=^TestStartupRejectsUnreadableFunnelHistory$")
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "CAREER_OPS_TEST_STARTUP="+root, "CAREER_OPS_ROOT="+root, "CAREER_OPS_TRACKER="+tracker)
	out, err := cmd.CombinedOutput()
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) || exitErr.ExitCode() != 1 {
		t.Fatalf("startup returned %v, want exit 1; output: %s", err, out)
	}
	if !strings.Contains(string(out), "Error: read funnel history:") || !strings.Contains(string(out), "status-log.tsv") {
		t.Fatalf("startup did not report the ledger failure: %s", out)
	}
}
