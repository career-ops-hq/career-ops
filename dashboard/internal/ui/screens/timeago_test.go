package screens

import (
	"testing"
	"time"
)

func TestFormatTimeAgo(t *testing.T) {
	today := time.Now().Format("2006-01-02")
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	threeDaysAgo := time.Now().AddDate(0, 0, -3).Format("2006-01-02")

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
	tomorrow := time.Now().AddDate(0, 0, 1).Format("2006-01-02")
	if got := formatTimeAgo(tomorrow); got != "today" {
		t.Errorf("future date should clamp to \"today\", got %q", got)
	}

	// Non-dates pass through untouched.
	if got := formatTimeAgo("—"); got != "—" {
		t.Errorf("non-date should pass through, got %q", got)
	}
}
