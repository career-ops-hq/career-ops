package screens

import (
	"testing"
	"time"

	"github.com/santifer/career-ops/dashboard/internal/i18n"
)

func TestFormatTimeAgo(t *testing.T) {
	// Pin the clock: with the wall clock, a run that crosses local midnight
	// between computing these dates and formatting them reads "today" as
	// "yesterday".
	now := time.Date(2026, 3, 10, 23, 59, 59, 0, time.Local)
	originalNowFunc := i18n.NowFunc
	i18n.NowFunc = func() time.Time { return now }
	t.Cleanup(func() { i18n.NowFunc = originalNowFunc })

	today := now.Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")
	threeDaysAgo := now.AddDate(0, 0, -3).Format("2006-01-02")

	// Day-granular dates never fabricate sub-day hours: same day is "today".
	if got := formatTimeAgo(today); got != "today" {
		t.Errorf("today should render as \"today\", got %q", got)
	}
	if got := formatTimeAgo(yesterday); got != "yesterday" {
		t.Errorf("one day ago should render as \"yesterday\", got %q", got)
	}
	if got := formatTimeAgo(threeDaysAgo); got != "3d ago" {
		t.Errorf("three days ago should render as \"3d ago\", got %q", got)
	}

	// Future dates clamp to "today" instead of going negative.
	tomorrow := now.AddDate(0, 0, 1).Format("2006-01-02")
	if got := formatTimeAgo(tomorrow); got != "today" {
		t.Errorf("future date should clamp to \"today\", got %q", got)
	}

	// Non-dates pass through untouched.
	if got := formatTimeAgo("—"); got != "—" {
		t.Errorf("non-date should pass through, got %q", got)
	}
}
