package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestViewerRebuildRenderClampsScrollOffset(t *testing.T) {
	m := ViewerModel{
		lines:        []string{"short"},
		scrollOffset: 20,
		width:        80,
		height:       20,
		theme:        theme.NewTheme("catppuccin-mocha"),
	}

	m.rebuildRender()

	maxScroll := len(m.renderedLines) - m.bodyHeight()
	if maxScroll < 0 {
		maxScroll = 0
	}
	if m.scrollOffset > maxScroll {
		t.Fatalf("expected scrollOffset <= %d after rebuild, got %d", maxScroll, m.scrollOffset)
	}
}

func TestRenderInlineElementsLeavesTrailingPunctuationUnstyled(t *testing.T) {
	match := reBareURL.FindString("Visit https://example.com.")

	if match != "https://example.com" {
		t.Fatalf("expected URL match without trailing period, got %q", match)
	}
}

func TestViewerWrapsFencedCodeLines(t *testing.T) {
	m := ViewerModel{
		lines: []string{
			"```",
			strings.Repeat("x", 40),
			"```",
		},
		width:  20,
		height: 20,
		theme:  theme.NewTheme("catppuccin-mocha"),
	}

	rendered := m.renderAll()
	maxWidth := m.width - 6
	if maxWidth < 10 {
		maxWidth = 10
	}

	if len(rendered) < 2 {
		t.Fatalf("expected fenced code to wrap into multiple lines, got %d", len(rendered))
	}
	for _, line := range rendered {
		if width := ansi.StringWidth(line); width > maxWidth {
			t.Fatalf("expected fenced code line width <= %d, got %d for %q", maxWidth, width, ansi.Strip(line))
		}
	}
}

func TestViewerRendersInlineMarkdownBeforeParagraphWrapping(t *testing.T) {
	m := ViewerModel{
		lines: []string{
			"See [documentation](https://example.com/really-long-path) before continuing.",
		},
		width:  30,
		height: 20,
		theme:  theme.NewTheme("catppuccin-mocha"),
	}

	rendered := strings.Join(m.renderAll(), "\n")
	plain := ansi.Strip(rendered)

	if strings.Contains(plain, "[") || strings.Contains(plain, "](") {
		t.Fatalf("expected rendered paragraph to hide markdown link syntax, got %q", plain)
	}
	if !strings.Contains(plain, "documentation") {
		t.Fatalf("expected rendered paragraph to keep link text, got %q", plain)
	}
}

func TestViewerEmptyContentRendersPlaceholder(t *testing.T) {
	m := ViewerModel{
		lines:  nil,
		width:  40,
		height: 10,
		theme:  theme.NewTheme("catppuccin-mocha"),
	}
	m.rebuildRender()

	if len(m.renderedLines) != 0 {
		t.Fatalf("expected zero rendered lines for empty content, got %d", len(m.renderedLines))
	}

	body := ansi.Strip(m.renderBody())
	if !strings.Contains(body, "(empty file)") {
		t.Fatalf("expected empty placeholder, got %q", body)
	}
}

func TestViewerInlineRenderingHandlesMixedTokens(t *testing.T) {
	m := ViewerModel{
		width:  60,
		height: 10,
		theme:  theme.NewTheme("catppuccin-mocha"),
	}

	rendered := m.renderInlineElementsAs(
		"start `code` mid **bold** then [link](https://example.com) end https://bare.example.com.",
		m.theme.Subtext,
	)
	plain := ansi.Strip(rendered)

	for _, want := range []string{"start ", "code", " mid ", "bold", " then ", "link", " end ", "https://bare.example.com"} {
		if !strings.Contains(plain, want) {
			t.Fatalf("expected plain output to contain %q, got %q", want, plain)
		}
	}
	for _, syntax := range []string{"`", "**", "[", "](", "](http"} {
		if strings.Contains(plain, syntax) {
			t.Fatalf("expected markdown syntax %q to be hidden, got %q", syntax, plain)
		}
	}
	if strings.HasSuffix(plain, ".") == false {
		t.Fatalf("expected trailing punctuation outside the bare URL, got %q", plain)
	}
}

func TestViewerIndentsWrappedBlockquoteLines(t *testing.T) {
	m := ViewerModel{
		width:  24,
		height: 20,
		theme:  theme.NewTheme("catppuccin-mocha"),
	}

	rendered := m.styleLine("> " + strings.Repeat("quoted ", 8))
	lines := strings.Split(ansi.Strip(rendered), "\n")

	if len(lines) < 2 {
		t.Fatalf("expected wrapped blockquote to render multiple lines, got %d", len(lines))
	}
	if !strings.HasPrefix(lines[0], "▎ ") {
		t.Fatalf("expected first blockquote line to keep border, got %q", lines[0])
	}
	if !strings.HasPrefix(lines[1], "  ") {
		t.Fatalf("expected wrapped blockquote continuation to align with text, got %q", lines[1])
	}
}
