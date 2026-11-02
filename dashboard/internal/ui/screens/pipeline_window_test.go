package screens

import (
	"fmt"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func windowTestApps(n int) []model.CareerApplication {
	statuses := []string{"Evaluated", "Applied", "Interview", "Rejected", "Offer"}
	apps := make([]model.CareerApplication, n)
	for i := range apps {
		apps[i] = model.CareerApplication{
			Number:   i + 1,
			Company:  fmt.Sprintf("Company %d with a fairly long name", i+1),
			Role:     fmt.Sprintf("Senior Platform Engineer %d", i+1),
			Status:   statuses[i%len(statuses)],
			Score:    3 + float64(i%20)/10,
			ScoreRaw: fmt.Sprintf("%.1f/5", 3+float64(i%20)/10),
			HasScore: true,
			Date:     "2026-09-01",
		}
	}
	return apps
}

// The old View: render the whole body, then slice out the visible lines.
func referenceBody(m PipelineModel, availHeight int) []string {
	lines := strings.Split(m.renderBody(), "\n")
	if m.scrollOffset > 0 && m.scrollOffset < len(lines) {
		lines = lines[m.scrollOffset:]
	}
	if len(lines) > availHeight {
		lines = lines[:availHeight]
	}
	return lines
}

func windowedBody(m PipelineModel, availHeight int) []string {
	lines := m.renderBodyWindow(m.scrollOffset, availHeight)
	if len(lines) == 0 {
		lines = m.renderBodyWindow(0, availHeight)
	}
	return lines
}

// The windowed body must be line-for-line what slicing the full render gave,
// in both view modes, at any cursor and offset, including a selected row that
// wraps on a narrow terminal and offsets past the end of the body.
func TestRenderBodyWindowMatchesFullRenderSliced(t *testing.T) {
	for _, n := range []int{0, 1, 7, 60} {
		for _, mode := range []string{"grouped", "flat"} {
			for _, width := range []int{40, 120} {
				m := NewPipelineModel(theme.NewTheme(""), windowTestApps(n), model.PipelineMetrics{}, t.TempDir(), width, 30)
				m.viewMode = mode
				// Every optional column on: the selected row is wider than a
				// 40-column terminal and wraps.
				for id := range m.visibleCols {
					m.visibleCols[id] = true
				}
				if n > 0 && width == 40 && !strings.Contains(m.renderAppLine(m.filtered[0], true), "\n") {
					t.Fatal("test premise: the selected row should wrap at width 40")
				}
				for _, cursor := range []int{0, n / 2, max(0, n-1)} {
					for _, offset := range []int{-1, 0, 1, 3, n / 2, n + 5, n + 100} {
						for _, h := range []int{3, 10, 200} {
							mm := m
							mm.cursor = cursor
							mm.scrollOffset = offset
							want := referenceBody(mm, h)
							got := windowedBody(mm, h)
							if strings.Join(got, "\n") != strings.Join(want, "\n") {
								t.Fatalf("n=%d mode=%s width=%d cursor=%d offset=%d h=%d:\n got %d lines\nwant %d lines", n, mode, width, cursor, offset, h, len(got), len(want))
							}
						}
					}
				}
			}
		}
	}
}

func TestPipelineViewStillShowsTheCursorRow(t *testing.T) {
	m := NewPipelineModel(theme.NewTheme(""), windowTestApps(500), model.PipelineMetrics{}, t.TempDir(), 120, 30)
	m.viewMode = "flat"
	m.cursor = 400
	m.adjustScroll()
	if !strings.Contains(m.View(), "#401") {
		t.Fatal("the row under the cursor is not on screen")
	}
}

func BenchmarkPipelineViewLargeTracker(b *testing.B) {
	m := NewPipelineModel(theme.NewTheme(""), windowTestApps(3000), model.PipelineMetrics{}, b.TempDir(), 140, 40)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = m.View()
	}
}
