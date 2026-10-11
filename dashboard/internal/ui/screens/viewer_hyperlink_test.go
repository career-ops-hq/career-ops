package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// linkTargets returns the URI of every OSC 8 opening sequence in s, in order.
func linkTargets(s string) []string {
	var out []string
	for _, sm := range reOSC8.FindAllStringSubmatch(s, -1) {
		if sm[2] != "" {
			out = append(out, sm[2])
		}
	}
	return out
}

// assertBalanced fails when a line leaves a hyperlink open at its end or
// closes one it never opened.
func assertBalanced(t *testing.T, i int, line string) {
	t.Helper()
	open := false
	for _, sm := range reOSC8.FindAllStringSubmatch(line, -1) {
		if sm[2] == "" {
			if !open {
				t.Fatalf("line %d closes a hyperlink it never opened: %q", i, line)
			}
			open = false
		} else {
			open = true
		}
	}
	if open {
		t.Fatalf("line %d leaves a hyperlink open: %q", i, line)
	}
}

func newLinkViewer(width int, lines ...string) ViewerModel {
	m := ViewerModel{lines: lines, width: width, height: 40, theme: theme.NewTheme("catppuccin-mocha")}
	m.rebuildRender()
	return m
}

func TestWebHyperlinkLinksOnlyAbsoluteHTTP(t *testing.T) {
	cases := []struct {
		url    string
		linked bool
	}{
		{"https://example.com/jobs/1", true},
		{"http://example.com", true},
		{"HTTPS://EXAMPLE.COM/x", true},
		{"https://", false},
		{"javascript:alert(1)", false},
		{"file:///etc/passwd", false},
		{"data:text/html,hi", false},
		{"mailto:jobs@example.com", false},
		{"ftp://example.com/file", false},
		{"reports/001-acme.md", false},
		{"", false},
	}
	for _, c := range cases {
		got := webHyperlink(c.url, "TEXT")
		if linked := got != "TEXT"; linked != c.linked {
			t.Errorf("webHyperlink(%q) linked=%v, want %v (got %q)", c.url, linked, c.linked, got)
		}
	}
}

func TestHyperlinkRejectsControlCharacters(t *testing.T) {
	for _, bad := range []string{
		"https://example.com/\x1b]8;;https://evil.example\x07",
		"https://example.com/\x07",
		"https://example.com/\x1b[2J",
		"https://example.com/\x00",
		"https://example.com/\x7f",
		"https://example.com/\u009b2J", // C1 CSI
		"https://example.com/\u009c",   // C1 ST
		"https://example.com/a\nb",
		"https://example.com/a\tb",
		"https://example.com/\xff", // invalid UTF-8
	} {
		if got := hyperlink(bad, "TEXT"); got != "TEXT" {
			t.Errorf("hyperlink(%q) = %q, want the text unlinked", bad, got)
		}
	}
}

func TestHyperlinkPercentEncodesSpacesAndNonASCII(t *testing.T) {
	got := linkTargets(hyperlink("file:///srv/career-ops/My Drive/cv-é.pdf", "cv"))
	if len(got) != 1 || got[0] != "file:///srv/career-ops/My%20Drive/cv-%C3%A9.pdf" {
		t.Fatalf("targets = %q, want the path percent-encoded", got)
	}
}

func TestHyperlinkKeepsQueryAndSemicolons(t *testing.T) {
	url := "https://example.com/jobs?id=1&ref=a;b#apply"
	if got := linkTargets(hyperlink(url, "x")); len(got) != 1 || got[0] != url {
		t.Fatalf("targets = %q, want %q unchanged", got, url)
	}
}

func TestViewerLinksBareAndMarkdownURLs(t *testing.T) {
	m := newLinkViewer(120,
		"Posting: https://jobs.example.com/acme/123.",
		"",
		"See [the careers page](https://acme.example.com/careers \"Acme\") and [home](<https://acme.example.com>).",
	)
	all := strings.Join(m.renderedLines, "\n")

	want := []string{"https://jobs.example.com/acme/123", "https://acme.example.com/careers", "https://acme.example.com"}
	got := linkTargets(all)
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("targets = %q, want %q", got, want)
	}
	plain := ansi.Strip(all)
	for _, s := range []string{"https://jobs.example.com/acme/123.", "the careers page", "home"} {
		if !strings.Contains(plain, s) {
			t.Fatalf("expected visible text %q, got %q", s, plain)
		}
	}
}

func TestViewerMarkdownLinkKeepsBalancedParentheses(t *testing.T) {
	m := newLinkViewer(120,
		"Read [Go](https://en.wikipedia.org/wiki/Go_(language)) (or [home](https://go.dev)).",
	)
	all := strings.Join(m.renderedLines, "\n")

	want := []string{"https://en.wikipedia.org/wiki/Go_(language)", "https://go.dev"}
	if got := linkTargets(all); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("targets = %q, want %q", got, want)
	}
	if plain := ansi.Strip(all); plain != "Read Go (or home)." {
		t.Fatalf("plain = %q, want the link syntax hidden and the outer parenthesis kept", plain)
	}
}

func TestViewerLeavesUnsafeMarkdownLinkTargetsPlain(t *testing.T) {
	m := newLinkViewer(120,
		"[click](javascript:alert(1)) [local](file:///etc/passwd) [rel](reports/001.md)",
	)
	all := strings.Join(m.renderedLines, "\n")

	if got := linkTargets(all); len(got) != 0 {
		t.Fatalf("expected no hyperlinks, got %q", got)
	}
	if plain := ansi.Strip(all); !strings.Contains(plain, "click") || !strings.Contains(plain, "local") {
		t.Fatalf("expected link labels to stay visible, got %q", plain)
	}
}

func TestViewerWrappedLinkIsClickableOnEveryLine(t *testing.T) {
	url := "https://jobs.example.com/acme/" + strings.Repeat("segment/", 12) + "123"
	m := newLinkViewer(30, "Apply at "+url+" today.")

	if len(m.renderedLines) < 3 {
		t.Fatalf("expected the URL to wrap over several lines, got %d", len(m.renderedLines))
	}
	for i, line := range m.renderedLines {
		assertBalanced(t, i, line)
		if w := ansi.StringWidth(line); w > m.width-6 {
			t.Fatalf("line %d width %d exceeds %d: %q", i, w, m.width-6, ansi.Strip(line))
		}
		plain := ansi.Strip(line)
		hasURLText := strings.Contains(plain, "segment") || strings.Contains(plain, "https://")
		if hasURLText {
			if got := linkTargets(line); len(got) != 1 || got[0] != url {
				t.Fatalf("line %d shows part of the URL but links %q, want %q", i, got, url)
			}
		}
	}
	plain := ansi.Strip(strings.Join(m.renderedLines, ""))
	if !strings.Contains(plain, url) {
		t.Fatalf("expected the full URL text across lines, got %q", plain)
	}
}

func TestViewerWrappedLinkStaysBalancedWhenScrolledMidLink(t *testing.T) {
	url := "https://jobs.example.com/" + strings.Repeat("long-path/", 15)
	m := newLinkViewer(30, url)
	m.height = 6 // body of 2 lines
	m.scrollOffset = 1

	visibleURLLines := 0
	for i, line := range strings.Split(m.View(), "\n") {
		assertBalanced(t, i, line)
		if strings.Contains(ansi.Strip(line), "long-path") {
			visibleURLLines++
			if got := linkTargets(line); len(got) != 1 || got[0] != url {
				t.Fatalf("visible line %d shows part of the URL but links %q, want %q", i, got, url)
			}
		}
	}
	if visibleURLLines == 0 {
		t.Fatal("expected the scrolled window to show part of the URL")
	}
}

func TestViewerTwoLinksOnOneLineKeepTheirOwnTargets(t *testing.T) {
	a := "https://a.example.com/" + strings.Repeat("x", 30)
	b := "https://b.example.com/" + strings.Repeat("y", 30)
	m := newLinkViewer(40, a+" and "+b)

	for i, line := range m.renderedLines {
		assertBalanced(t, i, line)
		plain := ansi.Strip(line)
		for _, target := range linkTargets(line) {
			if (target == a && strings.Contains(plain, "yyy")) || (target == b && strings.Contains(plain, "xxx")) {
				t.Fatalf("line %d links the wrong URL: %q -> %q", i, plain, target)
			}
		}
	}
}

func TestViewerLinksInListsQuotesHeadersAndTables(t *testing.T) {
	url := "https://jobs.example.com/acme/" + strings.Repeat("deep/", 10) + "42"
	m := newLinkViewer(40,
		"**URL:** "+url,
		"",
		"- apply: "+url,
		"",
		"1. "+url,
		"",
		"> "+url,
		"",
		"| Field | Value |",
		"|---|---|",
		"| Link | "+url+" |",
	)

	linked := 0
	for i, line := range m.renderedLines {
		assertBalanced(t, i, line)
		for _, target := range linkTargets(line) {
			if target != url {
				t.Fatalf("line %d links %q, want %q", i, target, url)
			}
			linked++
		}
	}
	if linked < 5 {
		t.Fatalf("expected the URL linked in all five blocks, got %d linked line(s)", linked)
	}
}

func TestBalanceHyperlinksCarriesLinkAcrossLines(t *testing.T) {
	open := "\x1b]8;;https://example.com\x07"
	stOpen := "\x1b]8;;https://st.example.com\x1b\\"
	in := []string{
		"plain",
		"start " + open + "https://exa",
		"mple.com/long",
		"/path" + osc8Close + " end",
		stOpen + "st-terminated",
		"tail\x1b]8;;\x1b\\",
		"balanced " + open + "x" + osc8Close,
	}
	out := balanceHyperlinks(in)

	want := []string{
		"plain",
		"start " + open + "https://exa" + osc8Close,
		open + "mple.com/long" + osc8Close,
		open + "/path" + osc8Close + " end",
		stOpen + "st-terminated" + osc8Close,
		stOpen + "tail\x1b]8;;\x1b\\",
		"balanced " + open + "x" + osc8Close,
	}
	for i := range want {
		if out[i] != want[i] {
			t.Errorf("line %d = %q, want %q", i, out[i], want[i])
		}
	}
}

func TestMarkdownLinkTarget(t *testing.T) {
	cases := map[string]string{
		"https://a.example":              "https://a.example",
		"  https://a.example  ":          "https://a.example",
		`https://a.example "Title"`:      "https://a.example",
		"<https://a.example/with space>": "https://a.example/with space",
		"":                               "",
	}
	for in, want := range cases {
		if got := markdownLinkTarget(in); got != want {
			t.Errorf("markdownLinkTarget(%q) = %q, want %q", in, got, want)
		}
	}
}
