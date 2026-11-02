package screens

import (
	"strings"
	"unicode/utf8"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// oneLine forces a chrome strip into the single row the height budget counted.
// lipgloss Width wraps; MaxHeight then keeps the first of those lines.
func oneLine(width int, style lipgloss.Style, content string) string {
	if width < 1 {
		width = 1
	}
	return style.Width(width).MaxHeight(1).Render(content)
}

// fitPlain shortens content to budget cells. The start says what failed and
// the end carries the filename and the reason, so a long path is what gives.
// Cuts count terminal cells, not runes, so wide runes cannot push the result
// past budget and onto a second line that oneLine would then drop.
func fitPlain(budget int, content string) string {
	if budget < 1 {
		return ""
	}
	width := ansi.StringWidth(content)
	if width <= budget {
		return content
	}
	const ellipsis = "..."
	if budget <= len(ellipsis) {
		return ansi.Truncate(content, budget, "")
	}
	tail := budget / 3
	if tail < 24 {
		tail = 24
	}
	if tail > budget-len(ellipsis)-8 {
		tail = budget - len(ellipsis) - 8
	}
	if tail < 1 {
		return lastCells(content, width, budget)
	}
	head := budget - tail - len(ellipsis)
	if head < 1 {
		return lastCells(content, width, budget)
	}
	return ansi.Truncate(content, head, "") + ellipsis + lastCells(content, width, tail)
}

// lastCells keeps at most n cells from the end of s, which is width cells wide.
// ansi.TruncateLeft keeps a wide rune that straddles the cut, so drop leading
// runes until the result fits. It can be one cell short, never over.
func lastCells(s string, width, n int) string {
	if width <= n {
		return s
	}
	out := ansi.TruncateLeft(s, width-n, "")
	for ansi.StringWidth(out) > n {
		_, size := utf8.DecodeRuneInString(out)
		out = out[size:]
	}
	return out
}

// fitTitleBar places info on the right when it fits, and drops it when the
// title alone is what the row can hold.
func fitTitleBar(width int, title, info string) string {
	inner := width - 4
	if inner < 1 {
		inner = 1
	}
	tw := lipgloss.Width(title)
	iw := lipgloss.Width(info)
	if iw > 0 && tw+1+iw <= inner {
		return title + strings.Repeat(" ", inner-tw-iw) + info
	}
	return title
}

type helpPiece struct {
	text string
	pin  bool
}

// joinHelp keeps pinned pieces (the way out of the screen) and as many of the
// others as fit, then the brand only when its plain width still has room.
func joinHelp(budget int, pieces []helpPiece, brandPlain, brandRendered string) string {
	if budget < 1 {
		budget = 1
	}
	pinW := 0
	var pins, rest []helpPiece
	for _, p := range pieces {
		if p.pin {
			pins = append(pins, p)
			pinW += lipgloss.Width(p.text)
		} else {
			rest = append(rest, p)
		}
	}
	pinsFit := pinW <= budget
	var b strings.Builder
	used := 0
	reserve := 0
	if pinsFit {
		reserve = pinW
	}
	for _, p := range rest {
		w := lipgloss.Width(p.text)
		if used+w+reserve <= budget {
			b.WriteString(p.text)
			used += w
		}
	}
	if pinsFit {
		for _, p := range pins {
			b.WriteString(p.text)
			used += lipgloss.Width(p.text)
		}
	}
	if brandRendered != "" {
		bw := lipgloss.Width(brandPlain)
		if used+1+bw <= budget {
			b.WriteString(strings.Repeat(" ", budget-used-bw))
			b.WriteString(brandRendered)
		}
	}
	return b.String()
}
