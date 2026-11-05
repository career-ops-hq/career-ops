package data

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func loadTLDR(t *testing.T, tldr string) string {
	t.Helper()
	root := t.TempDir()
	reports := filepath.Join(root, "reports")
	if err := os.MkdirAll(reports, 0o755); err != nil {
		t.Fatal(err)
	}
	body := "**TL;DR:** " + tldr + "\n"
	if err := os.WriteFile(filepath.Join(reports, "001.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	_, got, _, _ := LoadReportSummary(root, "reports/001.md")
	return got
}

// The preview cuts a long TL;DR at 120 characters. Cyrillic letters are two
// bytes and CJK three, so a cut by bytes split a character and stopped at
// about half the length an English TL;DR gets.
func TestLoadReportSummaryTruncatesTLDRByCharacters(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"ascii over the limit", strings.Repeat("a", 150), strings.Repeat("a", 117) + "..."},
		{"cyrillic over the limit", strings.Repeat("ж", 150), strings.Repeat("ж", 117) + "..."},
		{"cjk over the limit", strings.Repeat("職", 150), strings.Repeat("職", 117) + "..."},
		{"odd byte offset", "ab" + strings.Repeat("ж", 150), "ab" + strings.Repeat("ж", 115) + "..."},
		{"cyrillic under the limit but over 120 bytes", strings.Repeat("ж", 100), strings.Repeat("ж", 100)},
		{"exactly 120 characters", strings.Repeat("ж", 120), strings.Repeat("ж", 120)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := loadTLDR(t, tc.in)
			if !utf8.ValidString(got) {
				t.Fatalf("tldr is not valid UTF-8: %q", got)
			}
			if got != tc.want {
				t.Fatalf("tldr = %q (%d characters), want %d characters", got, utf8.RuneCountInString(got), utf8.RuneCountInString(tc.want))
			}
		})
	}
}
