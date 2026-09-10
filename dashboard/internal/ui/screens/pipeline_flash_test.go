package screens

import (
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// newFlashTestModel builds the smallest pipeline model that renders a help bar.
func newFlashTestModel(t *testing.T) PipelineModel {
	t.Helper()
	return NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		[]model.CareerApplication{{Company: "Globex", Role: "Engineer", Status: "Evaluated", Score: 4.0}},
		model.PipelineMetrics{Total: 1},
		t.TempDir(),
		120,
		40,
	)
}

func TestSanitizeFlashDropsControlCharacters(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			// The realistic shape: an escape sequence pasted into a tracker cell
			// travels into the flash as part of the URL it could not open.
			name: "escape sequence in a target",
			in:   "Could not open https://example.com/\x1b[2J\x1b[1;31mFAKE: exit status 1",
			want: "Could not open https://example.com/[2J[1;31mFAKE: exit status 1",
		},
		{
			name: "bare escape and DEL",
			in:   "a\x1bb\x7fc",
			want: "abc",
		},
		{
			name: "C1 control",
			in:   "a\u0085c",
			want: "ac",
		},
		{
			// The help bar is one line, so the three whitespace controls are
			// folded rather than dropped: dropping them would glue words.
			name: "whitespace controls become spaces",
			in:   "one\ttwo\rthree\nfour",
			want: "one two three four",
		},
		{
			// A byte that is not valid UTF-8 never reaches the terminal as
			// itself: strings.Map hands the mapping function utf8.RuneError
			// and writes U+FFFD, so a raw 0x9b — the byte an 8-bit terminal
			// would read as CSI — is already destroyed. It is replaced rather
			// than dropped, which is why the want here is not "ac".
			name: "raw 0x9b is not valid UTF-8 and becomes the replacement rune",
			in:   "a\x9bc",
			want: "a\uFFFDc",
		},
		{
			name: "ordinary text is untouched",
			in:   "Could not open /tmp/cv.pdf: exit status 1 — café ✅",
			want: "Could not open /tmp/cv.pdf: exit status 1 — café ✅",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sanitizeFlash(tc.in); got != tc.want {
				t.Fatalf("sanitizeFlash(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// The property that matters is narrower than any single expected string: no
// byte that a terminal could read as the start of an escape sequence survives,
// whether it arrived as a well-formed rune or as a raw byte in text that was
// never valid UTF-8 (a path or a child process's stderr need not be).
func TestSanitizeFlashLeavesNoEscapeIntroducerByte(t *testing.T) {
	inputs := []string{
		"a\x1bc",   // ESC
		"a\x9bc",   // raw CSI byte, invalid UTF-8 on its own
		"a\u009bc", // the same C1 control, correctly encoded
		"a\x80c",   // a stray continuation byte
		"one\ttwo",
		"café ✅",
	}
	for _, in := range inputs {
		out := sanitizeFlash(in)
		for i := 0; i < len(out); i++ {
			if out[i] == 0x1b || out[i] == 0x9b {
				t.Fatalf("sanitizeFlash(%q) = %q left byte %#x at %d", in, out, out[i], i)
			}
		}
	}
}

// The guard has to sit at the render, not at one producer: renderHelp is the
// single place every flash reaches the terminal.
func TestRenderHelpStripsControlCharactersFromFlash(t *testing.T) {
	pm := newFlashTestModel(t)
	pm.flash = "Could not open https://example.com/\x1b[2Jwiped: exit status 1"

	out := pm.renderHelp()

	// lipgloss emits its own escape sequences for colour, so assert on the
	// injected one specifically rather than on escapes in general.
	if strings.Contains(out, "\x1b[2J") {
		t.Fatalf("renderHelp passed an injected escape sequence through: %q", out)
	}
	if !strings.Contains(out, "wiped") {
		t.Fatalf("renderHelp dropped the surrounding text: %q", out)
	}
}
