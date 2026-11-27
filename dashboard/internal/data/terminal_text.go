package data

import "strings"

// SanitizeTerminalText removes bytes a terminal would treat as commands.
//
// The pipeline flash already drops these. Tracker cells and report text take
// another path and were printed raw, so a CSI sequence in a company name or a
// job description clears the alt screen. Tab, CR, and LF fold to a space.
// Other C0 controls, DEL, and C1 are dropped. strings.Map replaces a byte it
// cannot decode with U+FFFD, which is what keeps a raw 0x9b from arriving as
// itself.
func SanitizeTerminalText(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == '\t' || r == '\n' || r == '\r':
			return ' '
		case r < 0x20, r == 0x7f, r >= 0x80 && r <= 0x9f:
			return -1
		}
		return r
	}, s)
}
