package screens

import (
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/x/ansi"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// A posting dated today renders its age, not the dash reserved for a date in
// the future. The future-date guard parsed the date as UTC midnight and
// compared it with the real clock, so east of UTC a posting dated today was
// "in the future" until the UTC date caught up, while FormatTimeAgo, the label
// in the same cell, counted it as today in local time.
func TestPostedCellCountsLocalCalendarDays(t *testing.T) {
	origLocal, origNow := time.Local, i18n.NowFunc
	t.Cleanup(func() { time.Local, i18n.NowFunc = origLocal, origNow })
	time.Local = time.FixedZone("UTC+9", 9*3600)
	// 08:00 local on 1 December is still 30 November in UTC.
	i18n.NowFunc = func() time.Time { return time.Date(2026, 12, 1, 8, 0, 0, 0, time.Local) }

	m := NewPipelineModel(theme.NewTheme(""), nil, model.PipelineMetrics{}, t.TempDir(), 120, 30)
	cell := func(postedOn string) string {
		return strings.TrimSpace(ansi.Strip(m.renderPostedCell(model.CareerApplication{PostedOn: postedOn}, 14)))
	}

	if got := cell("2026-12-01"); got != i18n.Current.TimeToday {
		t.Errorf("posting dated today rendered %q, want %q", got, i18n.Current.TimeToday)
	}
	if got := cell("2026-11-30"); got != i18n.Current.TimeYesterday {
		t.Errorf("posting dated yesterday rendered %q, want %q", got, i18n.Current.TimeYesterday)
	}
	if got := cell("2026-12-02"); got != "—" {
		t.Errorf("posting dated tomorrow must still get the dash, rendered %q", got)
	}
}
