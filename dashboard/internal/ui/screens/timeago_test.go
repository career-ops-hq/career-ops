package screens

import (
	"strings"
	"testing"
	"time"
)

func TestFormatTimeAgo(t *testing.T) {
	today := time.Now().Format("2006-01-02")
	threeDaysAgo := time.Now().AddDate(0, 0, -3).Format("2006-01-02")

	if got := formatTimeAgo(today); !strings.HasSuffix(got, "h ago") {
		t.Errorf("today should render in hours, got %q", got)
	}
	got := formatTimeAgo(threeDaysAgo)
	// Midnight-based day math: 3 calendar days back is 3d (or 2d right after midnight).
	if got != "3d ago" && got != "2d ago" {
		t.Errorf("three days ago should render in days, got %q", got)
	}

	// Future dates clamp to zero instead of going negative.
	tomorrow := time.Now().AddDate(0, 0, 1).Format("2006-01-02")
	if got := formatTimeAgo(tomorrow); got != "0h ago" {
		t.Errorf("future date should clamp to 0h ago, got %q", got)
	}

	// Non-dates pass through untouched.
	if got := formatTimeAgo("—"); got != "—" {
		t.Errorf("non-date should pass through, got %q", got)
	}
}
